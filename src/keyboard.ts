import { BoxesError } from "./errors.js";
import { sh } from "./exec.js";
import { VIRSH, commonArgs } from "./virsh.js";
import { asRecord, boundedInteger, requireNameOrUuid, requireString } from "./validation.js";
import { requireRunningDomain } from "./libvirt.js";

export interface KeyboardRequest {
  nameOrUuid: string;
  keys: string[];
  holdMs: number;
}

const KEY_NAMES: Record<string, string> = {
  CTRL: "KEY_LEFTCTRL",
  ALT: "KEY_LEFTALT",
  SHIFT: "KEY_LEFTSHIFT",
  META: "KEY_LEFTMETA",
  SUPER: "KEY_LEFTMETA",
  ENTER: "KEY_ENTER",
  ESCAPE: "KEY_ESC",
  ESC: "KEY_ESC",
  TAB: "KEY_TAB",
  BACKSPACE: "KEY_BACKSPACE",
  DELETE: "KEY_DELETE",
  SPACE: "KEY_SPACE",
  INSERT: "KEY_INSERT",
  HOME: "KEY_HOME",
  END: "KEY_END",
  PAGEUP: "KEY_PAGEUP",
  PAGEDOWN: "KEY_PAGEDOWN",
  UP: "KEY_UP",
  DOWN: "KEY_DOWN",
  LEFT: "KEY_LEFT",
  RIGHT: "KEY_RIGHT",
  CAPSLOCK: "KEY_CAPSLOCK",
  NUMLOCK: "KEY_NUMLOCK",
  PRINT: "KEY_SYSRQ",
  PAUSE: "KEY_PAUSE"
};

for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") KEY_NAMES[letter] = `KEY_${letter}`;
for (let digit = 0; digit <= 9; digit += 1) KEY_NAMES[`DIGIT_${digit}`] = `KEY_${digit}`;
for (let functionKey = 1; functionKey <= 12; functionKey += 1) KEY_NAMES[`F${functionKey}`] = `KEY_F${functionKey}`;

export const allowedKeyboardKeys = Object.freeze(Object.keys(KEY_NAMES));

export function parseKeyboardRequest(value: unknown): KeyboardRequest {
  const args = asRecord(value);
  if (!Array.isArray(args.keys) || args.keys.length === 0 || args.keys.length > 16) {
    throw new BoxesError("INVALID_KEY", "keys must contain between 1 and 16 allowlisted keys");
  }
  const keys = args.keys.map((key, index) => {
    const publicName = requireString(key, `keys[${index}]`, "INVALID_KEY").toUpperCase();
    if (!(publicName in KEY_NAMES)) throw new BoxesError("INVALID_KEY", `Unsupported key: ${publicName}`);
    return publicName;
  });
  return {
    nameOrUuid: requireNameOrUuid(args),
    keys,
    holdMs: boundedInteger(args.holdMs, "holdMs", 0, 5_000, 100)
  };
}

export async function sendKeyboard(value: unknown): Promise<{ ok: true; backend: "virsh"; keys: string[]; holdMs: number }> {
  const request = parseKeyboardRequest(value);
  await requireRunningDomain(request.nameOrUuid);
  const virshKeys = request.keys.map(key => KEY_NAMES[key]);
  await sh(VIRSH, [
    ...commonArgs(),
    "send-key",
    request.nameOrUuid,
    "--codeset",
    "linux",
    "--holdtime",
    String(request.holdMs),
    ...virshKeys
  ]);
  return { ok: true, backend: "virsh", keys: request.keys, holdMs: request.holdMs };
}

export function virshKeyForTest(key: string): string | undefined {
  return KEY_NAMES[key];
}
