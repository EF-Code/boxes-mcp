import { access, lstat, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { BoxesError } from "./errors.js";
import { asRecord, parseEnvironmentInteger, requireNameOrUuid, requireString } from "./validation.js";
import { displayEndpoint } from "./display.js";
import { callSpiceHelper } from "./spice.js";
import { requireRunningDomain } from "./libvirt.js";

export interface TransferSource {
  sourcePath: string;
  basename: string;
  bytes: number;
}

export interface TransferRequest {
  nameOrUuid: string;
  sourcePath: unknown;
  timeoutMs: number;
}

export interface TransferResult {
  transportCompleted: boolean;
  bytes: number;
  destination?: string;
}

export async function validateTransferSource(value: unknown): Promise<TransferSource> {
  const requested = requireString(value, "sourcePath", "TRANSFER_PATH_DENIED");
  const configuredRoot = process.env.BOXES_TRANSFER_ROOT;
  if (!configuredRoot || configuredRoot.trim().length === 0) {
    throw new BoxesError("TRANSFER_PATH_DENIED", "BOXES_TRANSFER_ROOT must be configured for file transfer");
  }

  let root: string;
  let candidate: string;
  try {
    root = await realpath(resolve(configuredRoot));
    const requestedPath = resolve(requested);
    const requestedInfo = await lstat(requestedPath);
    if (requestedInfo.isSymbolicLink()) {
      throw new BoxesError("TRANSFER_PATH_DENIED", "Symlink source paths are not accepted");
    }
    candidate = await realpath(requestedPath);
  } catch (error) {
    if (error instanceof BoxesError) throw error;
    throw new BoxesError("TRANSFER_PATH_DENIED", "The transfer path does not exist or is inaccessible", { cause: error });
  }
  const relativePath = relative(root, candidate);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new BoxesError("TRANSFER_PATH_DENIED", "The transfer path is outside BOXES_TRANSFER_ROOT");
  }

  const info = await stat(candidate);
  if (!info.isFile()) throw new BoxesError("TRANSFER_PATH_DENIED", "Only regular files can be transferred");
  try {
    await access(candidate, constants.R_OK);
  } catch (error) {
    throw new BoxesError("TRANSFER_PATH_DENIED", "The transfer source is not readable", { cause: error });
  }
  const maximum = parseEnvironmentInteger("BOXES_MAX_TRANSFER_BYTES", 100 * 1024 * 1024, 1, 10 * 1024 * 1024 * 1024);
  if (info.size > maximum) throw new BoxesError("TRANSFER_TOO_LARGE", `Transfer exceeds ${maximum} bytes`);
  return { sourcePath: candidate, basename: basename(candidate), bytes: info.size };
}

export function parseTransferRequest(value: unknown): TransferRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BoxesError("INVALID_ARGUMENT", "Transfer arguments must be an object");
  }
  const args = asRecord(value, "transfer arguments");
  const nameOrUuid = requireNameOrUuid(args);
  const timeoutMs = args.timeoutMs === undefined ? 30_000 : args.timeoutMs;
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new BoxesError("INVALID_ARGUMENT", "timeoutMs must be an integer between 1000 and 120000");
  }
  return { nameOrUuid, sourcePath: args.sourcePath, timeoutMs };
}

function validateTransferResult(value: unknown, expectedBytes: number): TransferResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BoxesError("BACKEND_UNAVAILABLE", "SPICE helper returned an invalid transfer result");
  }
  const result = value as { transportCompleted?: unknown; bytes?: unknown; destination?: unknown };
  if (result.transportCompleted !== true || typeof result.bytes !== "number" || !Number.isInteger(result.bytes)
    || result.bytes !== expectedBytes) {
    throw new BoxesError("BACKEND_UNAVAILABLE", "SPICE helper did not confirm transfer completion");
  }
  return {
    transportCompleted: true,
    bytes: result.bytes,
    destination: typeof result.destination === "string" ? result.destination : undefined
  };
}

export function transferResultForTest(value: unknown, expectedBytes: number): TransferResult {
  return validateTransferResult(value, expectedBytes);
}

/** Transfer one confined regular file through the typed SPICE file-transfer operation. */
export async function transferFile(value: unknown): Promise<TransferResult & { source: TransferSource; backend: "spice" }> {
  const request = parseTransferRequest(value);
  await requireRunningDomain(request.nameOrUuid);
  const source = await validateTransferSource(request.sourcePath);
  const endpoint = await displayEndpoint(request.nameOrUuid);
  if (endpoint.protocol !== "spice") throw new BoxesError("UNSUPPORTED_DISPLAY", "File transfer requires a SPICE display");
  const result = await callSpiceHelper({
    operation: "file.transfer",
    domain: request.nameOrUuid,
    display: endpoint,
    arguments: { sourcePath: source.sourcePath, maxBytes: source.bytes, timeoutMs: request.timeoutMs }
  });
  return { ...validateTransferResult(result, source.bytes), source, backend: "spice" };
}
