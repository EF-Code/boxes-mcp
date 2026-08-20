import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { BoxesError } from "./errors.js";
import { parseEnvironmentInteger, requireString } from "./validation.js";

export interface TransferSource {
  sourcePath: string;
  basename: string;
  bytes: number;
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
    candidate = await realpath(resolve(requested));
  } catch (error) {
    throw new BoxesError("TRANSFER_PATH_DENIED", "The transfer path does not exist or is inaccessible", { cause: error });
  }
  const relativePath = relative(root, candidate);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new BoxesError("TRANSFER_PATH_DENIED", "The transfer path is outside BOXES_TRANSFER_ROOT");
  }

  const info = await stat(candidate);
  if (!info.isFile()) throw new BoxesError("TRANSFER_PATH_DENIED", "Only regular files can be transferred");
  const maximum = parseEnvironmentInteger("BOXES_MAX_TRANSFER_BYTES", 100 * 1024 * 1024, 1, 10 * 1024 * 1024 * 1024);
  if (info.size > maximum) throw new BoxesError("TRANSFER_TOO_LARGE", `Transfer exceeds ${maximum} bytes`);
  return { sourcePath: candidate, basename: candidate.slice(candidate.lastIndexOf("/") + 1), bytes: info.size };
}
