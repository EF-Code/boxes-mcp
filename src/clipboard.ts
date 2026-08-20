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

export type ClipboardPhase = "idle" | "awaiting-data" | "awaiting-request" | "sending" | "complete" | "failed";

export interface ClipboardState {
  operation: "read" | "write";
  phase: ClipboardPhase;
  maxBytes: number;
  text: string;
  bytes: number;
  errorCode?: "SPICE_AGENT_DISCONNECTED" | "CLIPBOARD_TOO_LARGE" | "INVALID_ARGUMENT";
}

export type ClipboardEvent =
  | { type: "agent-connected"; clipboard: boolean }
  | { type: "guest-grab"; hasUtf8: boolean }
  | { type: "guest-request"; hasUtf8: boolean }
  | { type: "data"; text: string; final: boolean }
  | { type: "release" }
  | { type: "disconnect" }
  | { type: "cancel" };

export function initialClipboardState(operation: "read" | "write", maxBytes: number): ClipboardState {
  return { operation, phase: "idle", maxBytes, text: "", bytes: 0 };
}

function failed(state: ClipboardState, errorCode: ClipboardState["errorCode"]): ClipboardState {
  return { ...state, phase: "failed", errorCode };
}

/** Pure reducer for the SPICE clipboard grab/request/notify/release lifecycle. */
export function reduceClipboardState(state: ClipboardState, event: ClipboardEvent): ClipboardState {
  if (state.phase === "complete" || state.phase === "failed") return state;
  if (event.type === "disconnect" || event.type === "cancel") {
    return failed(state, "SPICE_AGENT_DISCONNECTED");
  }
  if (event.type === "agent-connected") {
    return event.clipboard ? state : failed(state, "SPICE_AGENT_DISCONNECTED");
  }
  if (event.type === "guest-grab") {
    if (state.operation !== "read" || !event.hasUtf8) return failed(state, "INVALID_ARGUMENT");
    if (state.phase === "awaiting-data") return state;
    return { ...state, phase: "awaiting-data" };
  }
  if (event.type === "guest-request") {
    if (state.operation !== "write" || !event.hasUtf8) return failed(state, "INVALID_ARGUMENT");
    if (state.phase === "sending") return state;
    return { ...state, phase: "sending" };
  }
  if (event.type === "data") {
    if (state.operation !== "read" || state.phase !== "awaiting-data") {
      return failed(state, "INVALID_ARGUMENT");
    }
    const bytes = state.bytes + Buffer.byteLength(event.text, "utf8");
    if (bytes > state.maxBytes) return failed(state, "CLIPBOARD_TOO_LARGE");
    return {
      ...state,
      phase: event.final ? "complete" : "awaiting-data",
      text: state.text + event.text,
      bytes
    };
  }
  if (event.type === "release") {
    return state.operation === "write" && state.phase === "sending"
      ? { ...state, phase: "complete" }
      : failed(state, "SPICE_AGENT_DISCONNECTED");
  }
  return state;
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

function validateClipboardWriteResult(value: unknown): { backend: "spice"; completed: true } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BoxesError("BACKEND_UNAVAILABLE", "SPICE helper returned an invalid clipboard completion");
  }
  const result = value as Record<string, unknown>;
  if (result.backend !== "spice" || result.completed !== true) {
    throw new BoxesError("BACKEND_UNAVAILABLE", "SPICE helper did not confirm clipboard completion");
  }
  return { backend: "spice", completed: true };
}

export function clipboardResultForTest(value: unknown, operation: "read" | "write", maximum: number): unknown {
  return operation === "read" ? validateClipboardResult(value, maximum) : validateClipboardWriteResult(value);
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
    result: clipboardResultForTest(result, request.operation, maxBytes)
  };
}
