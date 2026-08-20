import { BoxesError } from "./errors.js";
import { displayEndpoint } from "./display.js";
import { callSpiceHelper } from "./spice.js";
import { asRecord, enumValue, requireNameOrUuid, requireString, parseEnvironmentInteger } from "./validation.js";
import { requireRunningDomain } from "./libvirt.js";

export interface ClipboardRequest {
  nameOrUuid: string;
  operation: "read" | "write";
  selection: "clipboard";
  text?: string;
}

function validateClipboardResult(value: unknown, maximum: number): { text: string; bytes: number } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BoxesError("BACKEND_UNAVAILABLE", "SPICE helper returned an invalid clipboard result");
  }
  const result = value as { text?: unknown; bytes?: unknown };
  if (typeof result.text !== "string" || typeof result.bytes !== "number" || !Number.isInteger(result.bytes)
    || result.bytes !== Buffer.byteLength(result.text, "utf8") || result.bytes > maximum) {
    throw new BoxesError("CLIPBOARD_TOO_LARGE", "SPICE helper returned invalid or oversized clipboard text");
  }
  return { text: result.text, bytes: result.bytes };
}

export function parseClipboardRequest(value: unknown): ClipboardRequest {
  const args = asRecord(value);
  const operation = enumValue(args.operation, "operation", ["read", "write"] as const);
  const selection = enumValue(args.selection, "selection", ["clipboard"] as const, "INVALID_ARGUMENT", "clipboard");
  const text = operation === "write" ? requireString(args.text, "text") : undefined;
  if (text !== undefined) {
    const maximum = parseEnvironmentInteger("BOXES_MAX_CLIPBOARD_BYTES", 1_048_576, 1, 100 * 1024 * 1024);
    if (Buffer.byteLength(text, "utf8") > maximum) {
      throw new BoxesError("CLIPBOARD_TOO_LARGE", `Clipboard text exceeds ${maximum} bytes`);
    }
  }
  return { nameOrUuid: requireNameOrUuid(args), operation, selection, text };
}

export async function clipboard(value: unknown): Promise<unknown> {
  const request = parseClipboardRequest(value);
  await requireRunningDomain(request.nameOrUuid);
  const endpoint = await displayEndpoint(request.nameOrUuid);
  if (endpoint.protocol !== "spice") throw new BoxesError("UNSUPPORTED_DISPLAY", "Clipboard requires a SPICE display");
  const maxBytes = parseEnvironmentInteger("BOXES_MAX_CLIPBOARD_BYTES", 1_048_576, 1, 100 * 1024 * 1024);
  const result = await callSpiceHelper({
    operation: request.operation === "read" ? "clipboard.read" : "clipboard.write",
    domain: request.nameOrUuid,
    display: endpoint,
    arguments: {
      selection: request.selection,
      text: request.text,
      maxBytes
    }
  });
  return {
    ok: true,
    backend: "spice",
    operation: request.operation,
    result: request.operation === "read" ? validateClipboardResult(result, maxBytes) : result
  };
}
