import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoxesError } from "./errors.js";
import { requireNameOrUuid, boundedInteger, asRecord, enumValue, parseEnvironmentInteger } from "./validation.js";
import { requireRunningDomain } from "./libvirt.js";
import { sh } from "./exec.js";
import { VIRSH, commonArgs } from "./virsh.js";

export type ScreenshotBackend = "auto" | "libvirt" | "spice" | "guest";

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
    backend: enumValue(args.backend, "backend", ["auto", "libvirt", "spice", "guest"] as const, "INVALID_ARGUMENT", "auto")
  };
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
  const header = data.subarray(0, 32).toString("ascii");
  if (/^P[123456]\s/.test(header)) return { mimeType: "image/x-portable-pixmap" };
  throw new BoxesError("BACKEND_UNAVAILABLE", "The screenshot format is not supported by MCP");
}

export async function captureScreenshot(value: unknown): Promise<ScreenshotResult> {
  const request = parseScreenshotRequest(value);
  await requireRunningDomain(request.nameOrUuid);
  if (request.backend === "spice" || request.backend === "guest") {
    throw new BoxesError("BACKEND_UNAVAILABLE", `${request.backend} screenshot backend is not available`);
  }

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
