import { BoxesError } from "./errors.js";
import { sh } from "./exec.js";
import { VIRSH, commonArgs } from "./virsh.js";
import { normalizedCoordinate, requireNameOrUuid } from "./validation.js";

export type QmpButton = "left" | "middle" | "right" | "wheel-up" | "wheel-down" | "wheel-left" | "wheel-right";

export interface QmpInputEvent {
  type: "abs" | "btn";
  data: { axis: "x" | "y"; value: number } | { button: QmpButton; down: boolean };
}

export interface QmpResponse {
  return?: unknown;
  error?: { class?: string; desc?: string };
}

export interface QmpMouseDevice {
  name?: string;
  index?: number;
  absolute?: boolean;
  [key: string]: unknown;
}

export interface QmpCommandInfo {
  name?: string;
  [key: string]: unknown;
}

function parseResponse(stdout: string): QmpResponse {
  const trimmed = stdout.trim();
  if (!trimmed) throw new BoxesError("QMP_UNAVAILABLE", "QMP returned no response");
  try {
    return JSON.parse(trimmed) as QmpResponse;
  } catch (error) {
    throw new BoxesError("QMP_UNAVAILABLE", "QMP returned invalid JSON", { cause: error });
  }
}

export async function qmpExecute(
  nameOrUuid: string,
  execute: "query-commands" | "query-mice" | "input-send-event",
  argumentsValue: Record<string, unknown> = {}
): Promise<unknown> {
  const validatedName = requireNameOrUuid({ nameOrUuid });
  const request = JSON.stringify({ execute, arguments: argumentsValue });
  let stdout: string;
  try {
    ({ stdout } = await sh(VIRSH, [
      ...commonArgs(),
      "qemu-monitor-command",
      validatedName,
      "--pretty",
      request
    ]));
  } catch (error) {
    throw new BoxesError("QMP_UNAVAILABLE", "Unable to communicate with the QEMU monitor", { cause: error });
  }

  const response = parseResponse(stdout);
  if (response.error) {
    const description = response.error.desc || "QMP command failed";
    const code = response.error.class === "CommandNotFound"
      ? "QMP_COMMAND_UNSUPPORTED"
      : "QMP_UNAVAILABLE";
    throw new BoxesError(code, description);
  }
  return response.return;
}

export async function probeQmp(nameOrUuid: string): Promise<QmpMouseDevice> {
  const commands = await queryQmpCommands(nameOrUuid);
  if (!commands.some(command => command.name === "input-send-event")) {
    throw new BoxesError("QMP_COMMAND_UNSUPPORTED", "QMP does not support input-send-event");
  }
  const devices = await queryQmpMice(nameOrUuid);
  const device = devices.find(candidate => candidate.absolute === true);
  if (!device) {
    throw new BoxesError("QMP_COMMAND_UNSUPPORTED", "QMP has no absolute pointer device");
  }
  return device;
}

export async function queryQmpCommands(nameOrUuid: string): Promise<QmpCommandInfo[]> {
  const result = await qmpExecute(nameOrUuid, "query-commands");
  if (!Array.isArray(result)) throw new BoxesError("QMP_UNAVAILABLE", "QMP returned invalid command metadata");
  return result.filter((value): value is QmpCommandInfo => value !== null && typeof value === "object")
    .map(value => value as QmpCommandInfo);
}

export async function queryQmpMice(nameOrUuid: string): Promise<QmpMouseDevice[]> {
  const result = await qmpExecute(nameOrUuid, "query-mice");
  if (!Array.isArray(result)) throw new BoxesError("QMP_UNAVAILABLE", "QMP returned invalid mouse metadata");
  return result.filter((value): value is QmpMouseDevice => value !== null && typeof value === "object")
    .map(value => value as QmpMouseDevice);
}

export function absoluteCoordinate(value: number, maximum = 0x7fff): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new BoxesError("INVALID_COORDINATES", "Normalized coordinates must be finite and between 0 and 1");
  }
  return normalizedCoordinate(value, maximum);
}

export function pixelCoordinate(value: number, size: number, maximum = 0x7fff): number {
  if (!Number.isInteger(value) || !Number.isInteger(size) || size <= 0 || value < 0 || value > size) {
    throw new BoxesError("INVALID_COORDINATES", "Pixel coordinates must be integers within their dimensions");
  }
  return Math.round(value / size * maximum);
}

export function qmpButton(button: QmpButton): QmpButton {
  return button;
}

export async function sendQmpInput(nameOrUuid: string, events: QmpInputEvent[]): Promise<void> {
  if (events.length === 0 || events.length > 64) {
    throw new BoxesError("INVALID_ARGUMENT", "QMP input event batches must contain between 1 and 64 events");
  }
  await qmpExecute(nameOrUuid, "input-send-event", { events });
}
