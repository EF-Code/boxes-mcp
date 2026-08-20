import { constants, existsSync, accessSync } from "node:fs";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";
import { BoxesError, type BoxesErrorCode } from "./errors.js";
import { parseEnvironmentInteger } from "./validation.js";
import type { DisplayEndpoint } from "./display.js";

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
  display: { uri: string };
  arguments: SpiceOperation["arguments"];
}

export interface SpiceHelperResponse {
  version: typeof SPICE_PROTOCOL_VERSION;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
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

  public async request(operation: SpiceOperation): Promise<unknown> {
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
      display: { uri: operation.display.display },
      arguments: operation.arguments
    };
    const line = JSON.stringify(request);
    if (Buffer.byteLength(line, "utf8") > this.maxLineBytes) {
      throw new BoxesError("INVALID_ARGUMENT", "SPICE helper request exceeds the protocol frame limit");
    }
    const timeoutMs = parseEnvironmentInteger("BOXES_SPICE_OPERATION_TIMEOUT_MS", 30_000, 100, 300_000);

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failChild(new BoxesError("OPERATION_TIMEOUT", "SPICE helper operation timed out"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(`${line}\n`);
      } catch (error) {
        clearTimeout(timer);
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
    child.on("error", error => this.failChild(responseError("SPICE helper failed", error)));
    child.on("exit", (code, signal) => {
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
    if (response.version !== SPICE_PROTOCOL_VERSION || typeof response.id !== "string" || typeof response.ok !== "boolean") {
      this.failChild(responseError("SPICE helper returned an invalid response envelope"));
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(helperError(response));
  }

  private failPending(error: BoxesError): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
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

export async function callSpiceHelper(operation: SpiceOperation): Promise<unknown> {
  return await client().request(operation);
}

export function closeSpiceHelper(): void {
  sharedClient?.close();
  sharedClient = undefined;
  sharedClientPath = undefined;
}
