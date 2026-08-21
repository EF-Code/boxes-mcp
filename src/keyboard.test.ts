import { beforeEach, describe, expect, it, vi } from "vitest";
import * as exec from "./exec.js";
import { allowedKeyboardKeys, keyboardKeyTable, parseKeyboardRequest, sendKeyboard, virshKeyForTest } from "./keyboard.js";

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
    expect(virshKeyForTest("ctrl")).toBeUndefined();
    expect(() => parseKeyboardRequest({ nameOrUuid: "vm", keys: ["rm -rf /"] })).toThrow(/Unsupported key/);
    expect(() => parseKeyboardRequest({ nameOrUuid: "vm", keys: ["A", "a"] })).toThrow(/duplicates/);
  });

  it("keeps one canonical mapping for every documented key", () => {
    expect(allowedKeyboardKeys).toHaveLength(73);
    expect(new Set(allowedKeyboardKeys).size).toBe(allowedKeyboardKeys.length);
    expect(keyboardKeyTable).toHaveLength(allowedKeyboardKeys.length);
    for (const key of keyboardKeyTable) expect(key.virshName).toMatch(/^KEY_[A-Z0-9]+$/);
  });

  it("constructs only the fixed send-key command", async () => {
    vi.mocked(exec.sh)
      .mockResolvedValueOnce({ stdout: "", stderr: "" }) // URI resolution probe
      .mockResolvedValueOnce({ stdout: "", stderr: "" });
    const result = await sendKeyboard({ nameOrUuid: "vm", keys: ["CTRL", "C"], holdMs: 250 });
    expect(result).toEqual({ ok: true, backend: "virsh", keys: ["CTRL", "C"], holdMs: 250 });
    expect(vi.mocked(exec.sh).mock.calls[1]).toEqual([
      "virsh",
      ["-c", "qemu:///system", "send-key", "vm", "--codeset", "linux", "--holdtime", "250", "KEY_LEFTCTRL", "KEY_C"]
    ]);
  });

  it("bounds hold time and sequence length", () => {
    expect(() => parseKeyboardRequest({ nameOrUuid: "vm", keys: ["A"], holdMs: 5001 })).toThrow();
    expect(() => parseKeyboardRequest({ nameOrUuid: "vm", keys: Array(17).fill("A") })).toThrow();
  });

  it("maps virsh timeout and failure without leaking raw command behavior", async () => {
    vi.mocked(exec.sh).mockRejectedValueOnce(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }));
    await expect(sendKeyboard({ nameOrUuid: "vm", keys: ["ENTER"] }))
      .rejects.toMatchObject({ code: "OPERATION_TIMEOUT" });
    vi.mocked(exec.sh).mockRejectedValueOnce(new Error("virsh failed"));
    await expect(sendKeyboard({ nameOrUuid: "vm", keys: ["ENTER"] }))
      .rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  });
});
