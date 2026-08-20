import { BoxesError } from "./errors.js";
import { sh } from "./exec.js";
import { VIRSH, commonArgs } from "./virsh.js";
import { normalizedCoordinate } from "./validation.js";

export type QmpButton = "left" | "middle" | "right" | "wheel-up" | "wheel-down" | "wheel-left" | "wheel-right";

export interface QmpInputEvent {
  type: "abs" | "btn";
  data: Record<string, unknown>;
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
  const request = JSON.stringify({ execute, arguments: argumentsValue });
  let stdout: string;
  try {
    ({ stdout } = await sh(VIRSH, [
      ...commonArgs(),
      "qemu-monitor-command",
      nameOrUuid,
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

export async function probeQmp(nameOrUuid: string): Promise<void> {
  const commands = await queryQmpCommands(nameOrUuid);
  if (!commands.some(command => command.name === "input-send-event")) {
    throw new BoxesError("QMP_COMMAND_UNSUPPORTED", "QMP does not support input-send-event");
  }
  const devices = await queryQmpMice(nameOrUuid);
  if (!devices.some(device => device.absolute === true)) {
    throw new BoxesError("QMP_COMMAND_UNSUPPORTED", "QMP has no absolute pointer device");
  }
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
  return normalizedCoordinate(value, maximum);
}

export function pixelCoordinate(value: number, size: number, maximum = 0x7fff): number {
  if (size <= 0) throw new BoxesError("INVALID_COORDINATES", "Coordinate dimensions must be positive");
  return Math.round(Math.min(size, Math.max(0, value)) / size * maximum);
}

export function qmpButton(button: QmpButton): QmpButton {
  return button;
}

export async function sendQmpInput(nameOrUuid: string, events: QmpInputEvent[]): Promise<void> {
  if (events.length === 0) throw new BoxesError("INVALID_ARGUMENT", "At least one QMP input event is required");
  await qmpExecute(nameOrUuid, "input-send-event", { events });
}
