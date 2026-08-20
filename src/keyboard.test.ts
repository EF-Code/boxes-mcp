import { beforeEach, describe, expect, it, vi } from "vitest";
import * as exec from "./exec.js";
import { parseKeyboardRequest, sendKeyboard, virshKeyForTest } from "./keyboard.js";

vi.mock("./exec.js");
vi.mock("./libvirt.js", () => ({
  requireRunningDomain: vi.fn().mockResolvedValue({ State: "running" })
}));

describe("keyboard validation and virsh adapter", () => {
  beforeEach(() => vi.resetAllMocks());

  it("maps an allowlisted chord and rejects arbitrary keys", () => {
    expect(parseKeyboardRequest({ nameOrUuid: "vm", keys: ["CTRL", "ALT", "DELETE"] })).toMatchObject({
      nameOrUuid: "vm",
      keys: ["CTRL", "ALT", "DELETE"],
      holdMs: 100
    });
    expect(virshKeyForTest("CTRL")).toBe("KEY_LEFTCTRL");
    expect(() => parseKeyboardRequest({ nameOrUuid: "vm", keys: ["rm -rf /"] })).toThrow(/Unsupported key/);
  });

  it("constructs only the fixed send-key command", async () => {
    vi.mocked(exec.sh).mockResolvedValueOnce({ stdout: "", stderr: "" });
    const result = await sendKeyboard({ nameOrUuid: "vm", keys: ["CTRL", "C"], holdMs: 250 });
    expect(result).toEqual({ ok: true, backend: "virsh", keys: ["CTRL", "C"], holdMs: 250 });
    expect(vi.mocked(exec.sh).mock.calls[0]).toEqual([
      "virsh",
      ["-c", "qemu:///system", "send-key", "vm", "--codeset", "linux", "--holdtime", "250", "KEY_LEFTCTRL", "KEY_C"]
    ]);
  });

  it("bounds hold time and sequence length", () => {
    expect(() => parseKeyboardRequest({ nameOrUuid: "vm", keys: ["A"], holdMs: 5001 })).toThrow();
    expect(() => parseKeyboardRequest({ nameOrUuid: "vm", keys: Array(17).fill("A") })).toThrow();
  });
});
