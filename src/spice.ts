import { constants, existsSync, accessSync } from "node:fs";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";
import { BoxesError, type BoxesErrorCode } from "./errors.js";
import { parseEnvironmentInteger } from "./validation.js";
import type { DisplayEndpoint, DisplayTransport } from "./display.js";

export const SPICE_PROTOCOL_VERSION = 1;
export const MAX_HELPER_LINE_BYTES = 4 * 1024 * 1024;
const MAX_PENDING_REQUESTS = 128;

export interface SpiceStatusArguments {
  timeoutMs?: number;
}

export interface SpiceMouseArguments {
  action: "move" | "click" | "scroll";
  x: number;
  y: number;
  coordinateSpace: "normalized" | "pixels";
  width?: number;
  height?: number;
  button?: "left" | "middle" | "right";
  deltaX?: number;
  deltaY?: number;
}

export interface SpiceClipboardArguments {
  selection: "clipboard";
  maxBytes: number;
  text?: string;
}

export interface SpiceTransferArguments {
  sourcePath: string;
  maxBytes: number;
  timeoutMs?: number;
}

export interface SpiceDragDropArguments extends SpiceTransferArguments {
  x: number;
  y: number;
  coordinateSpace: "normalized" | "pixels";
  width?: number;
  height?: number;
}

interface SpiceOperationContext {
  domain: string;
  display: DisplayEndpoint;
}

export type SpiceOperation = SpiceOperationContext & (
  | { operation: "status"; arguments: SpiceStatusArguments }
  | { operation: "mouse"; arguments: SpiceMouseArguments }
  | { operation: "clipboard.read"; arguments: SpiceClipboardArguments }
  | { operation: "clipboard.write"; arguments: SpiceClipboardArguments }
  | { operation: "file.transfer"; arguments: SpiceTransferArguments }
  | { operation: "drag-drop"; arguments: SpiceDragDropArguments }
);

export interface SpiceHelperRequest {
  version: typeof SPICE_PROTOCOL_VERSION;
  id: string;
  operation: SpiceOperation["operation"];
  domain: string;
  display: { uri: string; transport?: DisplayTransport };
  arguments: SpiceOperation["arguments"];
}

export interface SpiceHelperResponse {
  version: typeof SPICE_PROTOCOL_VERSION;
  id: string;
  ok: boolean;
  event?: "progress";
  progress?: { bytes?: number; totalBytes?: number };
  result?: unknown;
  error?: { code?: string; message?: string };
}

export interface SpiceStatusResult {
  mainChannel: "connected" | "disconnected" | "connecting";
  inputsChannel: "connected" | "disconnected" | "connecting";
  displayChannel: "connected" | "disconnected" | "connecting";
  agentConnected: boolean;
  clipboard: boolean;
  fileTransfer: boolean;
  mouseMode: number;
  geometryKnown: boolean;
  width: number;
  height: number;
}

export interface SpiceMouseResult {
  backend: "spice";
  completed: true;
  display: number;
  width: number;
  height: number;
}

function operationTimeoutMs(operation: SpiceOperation): number {
  const configured = parseEnvironmentInteger("BOXES_SPICE_OPERATION_TIMEOUT_MS", 30_000, 100, 300_000);
  const requested = "timeoutMs" in operation.arguments ? operation.arguments.timeoutMs : undefined;
  return typeof requested === "number" && Number.isInteger(requested) && requested >= 1_000 && requested <= 120_000
    ? requested
    : configured;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseSpiceStatus(value: unknown): SpiceStatusResult {
  if (!isObject(value)) throw new BoxesError("SPICE_UNAVAILABLE", "SPICE helper returned invalid status data");
  const states = ["connected", "disconnected", "connecting"] as const;
  const status = value as Record<string, unknown>;
  const channel = (name: string): SpiceStatusResult["mainChannel"] => {
    const candidate = status[name];
    if (!states.includes(candidate as SpiceStatusResult["mainChannel"])) {
      throw new BoxesError("SPICE_UNAVAILABLE", `SPICE helper returned invalid ${name} state`);
    }
    return candidate as SpiceStatusResult["mainChannel"];
  };
  const bool = (name: string): boolean => {
    if (typeof status[name] !== "boolean") throw new BoxesError("SPICE_UNAVAILABLE", `SPICE helper returned invalid ${name}`);
    return status[name] as boolean;
  };
  const integer = (name: string): number => {
    if (typeof status[name] !== "number" || !Number.isInteger(status[name]) || (name !== "mouseMode" && (status[name] as number) < 0)) {
      throw new BoxesError("SPICE_UNAVAILABLE", `SPICE helper returned invalid ${name}`);
    }
    return status[name] as number;
  };
  return {
    mainChannel: channel("mainChannel"),
    inputsChannel: channel("inputsChannel"),
    displayChannel: channel("displayChannel"),
    agentConnected: bool("agentConnected"),
    clipboard: bool("clipboard"),
    fileTransfer: bool("fileTransfer"),
    mouseMode: integer("mouseMode"),
    geometryKnown: bool("geometryKnown"),
    width: integer("width"),
    height: integer("height")
  };
}

export function parseSpiceMouseResult(value: unknown): SpiceMouseResult {
  if (!isObject(value) || value.backend !== "spice" || value.completed !== true
    || typeof value.display !== "number" || !Number.isInteger(value.display) || value.display < 0
    || typeof value.width !== "number" || !Number.isInteger(value.width) || value.width < 1
    || typeof value.height !== "number" || !Number.isInteger(value.height) || value.height < 1) {
    throw new BoxesError("SPICE_UNAVAILABLE", "SPICE helper returned invalid mouse completion data");
  }
  return {
    backend: "spice",
    completed: true,
    display: value.display,
    width: value.width,
    height: value.height
  };
}

export function spiceHelperPath(): string | undefined {
  const configured = process.env.BOXES_SPICE_HELPER?.trim();
  if (!configured || !existsSync(configured)) return undefined;
  try {
    accessSync(configured, constants.X_OK);
    return configured;
  } catch {
    return undefined;
  }
}

export function spiceHelperConfigured(): boolean {
  return spiceHelperPath() !== undefined;
}

function helperError(response: SpiceHelperResponse): BoxesError {
  const supported = new Set<BoxesErrorCode>([
    "INVALID_ARGUMENT",
    "BACKEND_UNAVAILABLE",
    "SPICE_UNAVAILABLE",
    "SPICE_AGENT_DISCONNECTED",
    "SPICE_CAPABILITY_MISSING",
    "OPERATION_TIMEOUT",
    "CLIPBOARD_TOO_LARGE",
    "TRANSFER_PATH_DENIED",
    "TRANSFER_TOO_LARGE"
  ]);
  const code = supported.has(response.error?.code as BoxesErrorCode)
    ? response.error?.code as BoxesErrorCode
    : "SPICE_UNAVAILABLE";
  return new BoxesError(code, response.error?.message || "SPICE helper operation failed");
}

function responseError(message: string, cause?: unknown): BoxesError {
  return new BoxesError("SPICE_UNAVAILABLE", message, cause === undefined ? undefined : { cause });
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
  abortCleanup?: () => void;
}

type SpiceChild = ChildProcessByStdio<Writable, Readable, null>;

/** Persistent, bounded, fixed-executable client for the companion SPICE helper. */
export class SpiceHelperClient {
  private child?: SpiceChild;
  private childPath?: string;
  private frameBuffer = "";
  private readonly decoder = new StringDecoder("utf8");
  private readonly pending = new Map<string, PendingRequest>();

  public constructor(private readonly maxLineBytes = MAX_HELPER_LINE_BYTES) {}

  public async request(operation: SpiceOperation, options: { signal?: AbortSignal } = {}): Promise<unknown> {
    const helper = spiceHelperPath();
    if (!helper) throw new BoxesError("SPICE_UNAVAILABLE", "BOXES_SPICE_HELPER is not configured or executable");
    if (!operation.domain || operation.display.protocol !== "spice") {
      throw new BoxesError("SPICE_CAPABILITY_MISSING", "A SPICE display endpoint is required");
    }
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      throw new BoxesError("BACKEND_UNAVAILABLE", "Too many pending SPICE helper requests");
    }

    const child = this.ensureChild(helper);
    const id = `boxes-${randomUUID()}`;
    const request: SpiceHelperRequest = {
      version: SPICE_PROTOCOL_VERSION,
      id,
      operation: operation.operation,
      domain: operation.domain,
      display: operation.display.transport === "libvirt-fd"
        ? { uri: operation.display.display, transport: "libvirt-fd" }
        : { uri: operation.display.display },
      arguments: operation.arguments
    };
    const line = JSON.stringify(request);
    if (Buffer.byteLength(line, "utf8") > this.maxLineBytes) {
      throw new BoxesError("INVALID_ARGUMENT", "SPICE helper request exceeds the protocol frame limit");
    }
    const timeoutMs = operationTimeoutMs(operation);

    return await new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new BoxesError("OPERATION_CANCELLED", "SPICE helper operation was cancelled before submission"));
        return;
      }
      const timer = setTimeout(() => {
        this.failChild(new BoxesError("OPERATION_TIMEOUT", "SPICE helper operation timed out"));
      }, timeoutMs);
      const onAbort = () => {
        this.failChild(new BoxesError("OPERATION_CANCELLED", "SPICE helper operation was cancelled"));
      };
      const abortCleanup = options.signal
        ? () => options.signal?.removeEventListener("abort", onAbort)
        : undefined;
      this.pending.set(id, { resolve, reject, timer, abortCleanup });
      options.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        child.stdin.write(`${line}\n`);
      } catch (error) {
        clearTimeout(timer);
        abortCleanup?.();
        this.pending.delete(id);
        reject(responseError("Unable to write to the SPICE helper", error));
      }
    });
  }

  public close(): void {
    this.failChild(responseError("SPICE helper client closed"));
  }

  private ensureChild(helper: string): SpiceChild {
    if (this.child && this.childPath === helper && !this.child.killed) return this.child;
    if (this.child) this.failChild(responseError("SPICE helper executable changed"));

    const child = spawn(helper, [], {
      shell: false,
      stdio: ["pipe", "pipe", "ignore"]
    });
    this.child = child;
    this.childPath = helper;
    this.frameBuffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => this.consume(chunk as string));
    child.on("error", error => {
      if (this.child === child) this.failChild(responseError("SPICE helper failed", error));
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.childPath = undefined;
      if (this.pending.size > 0) {
        this.failPending(responseError(`SPICE helper exited before completing requests (${code ?? signal ?? "unknown"})`));
      }
    });
    return child;
  }

  private consume(chunk: string): void {
    this.frameBuffer += this.decoder.write(chunk);
    if (Buffer.byteLength(this.frameBuffer, "utf8") > this.maxLineBytes) {
      this.failChild(responseError("SPICE helper response exceeded the protocol frame limit"));
      return;
    }
    let newline = this.frameBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.frameBuffer.slice(0, newline).replace(/\r$/, "");
      this.frameBuffer = this.frameBuffer.slice(newline + 1);
      if (line.length > 0) this.consumeResponse(line);
      newline = this.frameBuffer.indexOf("\n");
    }
  }

  private consumeResponse(line: string): void {
    if (Buffer.byteLength(line, "utf8") > this.maxLineBytes) {
      this.failChild(responseError("SPICE helper response exceeded the protocol frame limit"));
      return;
    }
    let response: SpiceHelperResponse;
    try {
      response = JSON.parse(line) as SpiceHelperResponse;
    } catch (error) {
      this.failChild(responseError("SPICE helper returned invalid JSON", error));
      return;
    }
    if (response.version !== SPICE_PROTOCOL_VERSION || typeof response.id !== "string") {
      this.failChild(responseError("SPICE helper returned an invalid response envelope"));
      return;
    }
    if (response.event === "progress") {
      const progress = response.progress;
      if (!progress || typeof progress.bytes !== "number" || !Number.isInteger(progress.bytes) || progress.bytes < 0
        || typeof progress.totalBytes !== "number" || !Number.isInteger(progress.totalBytes)
        || progress.totalBytes < 0 || progress.bytes > progress.totalBytes) {
        this.failChild(responseError("SPICE helper returned invalid progress data"));
      }
      return;
    }
    if (typeof response.ok !== "boolean") {
      this.failChild(responseError("SPICE helper returned an invalid response envelope"));
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    pending.abortCleanup?.();
    if (response.ok) pending.resolve(response.result);
    else pending.reject(helperError(response));
  }

  private failPending(error: BoxesError): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.abortCleanup?.();
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  private failChild(error: BoxesError): void {
    const child = this.child;
    this.child = undefined;
    this.childPath = undefined;
    this.failPending(error);
    if (child && !child.killed) child.kill();
  }
}

let sharedClient: SpiceHelperClient | undefined;
let sharedClientPath: string | undefined;

function client(): SpiceHelperClient {
  const path = spiceHelperPath();
  if (!path) throw new BoxesError("SPICE_UNAVAILABLE", "BOXES_SPICE_HELPER is not configured or executable");
  if (!sharedClient || sharedClientPath !== path) {
    sharedClient?.close();
    sharedClient = new SpiceHelperClient();
    sharedClientPath = path;
  }
  return sharedClient;
}

export async function callSpiceHelper(operation: SpiceOperation, options: { signal?: AbortSignal } = {}): Promise<unknown> {
  return await client().request(operation, options);
}

export async function spiceHelperStatus(domain: string, display: DisplayEndpoint): Promise<SpiceStatusResult> {
  const result = await callSpiceHelper({ operation: "status", domain, display, arguments: {} });
  return parseSpiceStatus(result);
}

export function closeSpiceHelper(): void {
  sharedClient?.close();
  sharedClient = undefined;
  sharedClientPath = undefined;
}
