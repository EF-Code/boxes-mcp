import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoxesError } from "./errors.js";
import { requireNameOrUuid, boundedInteger, asRecord, enumValue, parseEnvironmentInteger } from "./validation.js";
import { requireRunningDomain } from "./libvirt.js";
import { sh } from "./exec.js";
import { VIRSH, commonArgs } from "./virsh.js";

export type ScreenshotBackend = "auto" | "libvirt";

export interface ScreenshotRequest {
  nameOrUuid: string;
  screen: number;
  backend: ScreenshotBackend;
}

export interface ScreenshotResult {
  data: string;
  mimeType: string;
  bytes: number;
  width?: number;
  height?: number;
  screen: number;
  backend: "libvirt";
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

export function parseScreenshotRequest(value: unknown): ScreenshotRequest {
  const args = asRecord(value);
  return {
    nameOrUuid: requireNameOrUuid(args),
    screen: boundedInteger(args.screen, "screen", 0, 16, 0),
    backend: enumValue(args.backend, "backend", ["auto", "libvirt"] as const, "INVALID_ARGUMENT", "auto")
  };
}

function ppmTokenize(data: Buffer): string[] {
  const header = data.subarray(0, Math.min(data.length, 64 * 1024)).toString("ascii");
  const tokens: string[] = [];
  let index = 0;
  while (index < header.length && tokens.length < 4) {
    while (index < header.length && /\s/.test(header[index])) index += 1;
    if (header[index] === "#") {
      while (index < header.length && header[index] !== "\n") index += 1;
      continue;
    }
    const start = index;
    while (index < header.length && !/\s/.test(header[index]) && header[index] !== "#") index += 1;
    if (index === start) break;
    tokens.push(header.slice(start, index));
  }
  return tokens;
}

function ppmType(data: Buffer): { mimeType: string; width: number; height: number } {
  const tokens = ppmTokenize(data);
  const magic = tokens[0];
  if (!magic || !/^P[1-6]$/.test(magic) || tokens.length < 3) {
    throw new BoxesError("BACKEND_UNAVAILABLE", "The screenshot contains a malformed PPM header");
  }
  const width = Number(tokens[1]);
  const height = Number(tokens[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > 1_000_000 || height > 1_000_000) {
    throw new BoxesError("BACKEND_UNAVAILABLE", "The screenshot contains invalid PPM dimensions");
  }
  if (magic !== "P1" && magic !== "P4" && tokens.length < 4) {
    throw new BoxesError("BACKEND_UNAVAILABLE", "The screenshot contains a malformed PPM max value");
  }
  if (magic !== "P1" && magic !== "P4") {
    const maxValue = Number(tokens[3]);
    if (!Number.isInteger(maxValue) || maxValue < 1 || maxValue > 65535) {
      throw new BoxesError("BACKEND_UNAVAILABLE", "The screenshot contains an invalid PPM max value");
    }
  }
  return { mimeType: "image/x-portable-pixmap", width, height };
}

function imageType(data: Buffer): { mimeType: string; width?: number; height?: number } {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mimeType: "image/png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length >= 10 && data.subarray(0, 3).toString("ascii") === "GIF") {
    return { mimeType: "image/gif", width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  }
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xd8) {
    return { mimeType: "image/jpeg" };
  }
  if (data.length >= 2 && data.subarray(0, 2).toString("ascii") === "BM") {
    return {
      mimeType: "image/bmp",
      width: data.length >= 22 ? Math.abs(data.readInt32LE(18)) : undefined,
      height: data.length >= 26 ? Math.abs(data.readInt32LE(22)) : undefined
    };
  }
  const header = data.subarray(0, 2).toString("ascii");
  if (/^P[123456]$/.test(header)) return ppmType(data);
  throw new BoxesError("BACKEND_UNAVAILABLE", "The screenshot format is not supported by MCP");
}

function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; killed?: unknown };
  return candidate.code === "ETIMEDOUT" || candidate.killed === true;
}

export async function captureScreenshot(value: unknown): Promise<ScreenshotResult> {
  const request = parseScreenshotRequest(value);
  await requireRunningDomain(request.nameOrUuid);
  const maxBytes = parseEnvironmentInteger(
    "BOXES_MAX_SCREENSHOT_BYTES",
    DEFAULT_MAX_BYTES,
    1024,
    200 * 1024 * 1024
  );
  const configuredBase = process.env.BOXES_ARTIFACT_DIR;
  const base = configuredBase && configuredBase.trim().length > 0
    ? configuredBase
    : join(tmpdir(), "boxes-mcp");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const tempDir = await mkdtemp(join(base, "screenshot-"));
  const outputPath = join(tempDir, "screen");

  try {
    await sh(VIRSH, [
      ...commonArgs(),
      "screenshot",
      request.nameOrUuid,
      "--file",
      outputPath,
      "--screen",
      String(request.screen)
    ]);
    const outputStat = await stat(outputPath);
    if (outputStat.size > maxBytes) {
      throw new BoxesError("ARTIFACT_TOO_LARGE", `Screenshot exceeds ${maxBytes} bytes`);
    }
    const data = await readFile(outputPath);
    if (data.length > maxBytes) {
      throw new BoxesError("ARTIFACT_TOO_LARGE", `Screenshot exceeds ${maxBytes} bytes`);
    }
    const type = imageType(data);
    return {
      data: data.toString("base64"),
      mimeType: type.mimeType,
      bytes: data.length,
      width: type.width,
      height: type.height,
      screen: request.screen,
      backend: "libvirt"
    };
  } catch (error) {
    if (error instanceof BoxesError) throw error;
    if (isTimeout(error)) {
      throw new BoxesError("OPERATION_TIMEOUT", "Screenshot capture timed out", { cause: error });
    }
    throw new BoxesError("BACKEND_UNAVAILABLE", "Unable to capture the domain screenshot", { cause: error });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function imageTypeForTest(data: Buffer): { mimeType: string; width?: number; height?: number } {
  return imageType(data);
}

export async function listArtifactEntriesForTest(base: string): Promise<string[]> {
  try {
    return await readdir(base);
  } catch {
    return [];
  }
}
