import { beforeEach, describe, expect, it, vi } from "vitest";
import * as exec from "./exec.js";
import { qmpEventsForTest, sendMouse } from "./mouse.js";

vi.mock("./exec.js");
vi.mock("./libvirt.js", () => ({
  requireRunningDomain: vi.fn().mockResolvedValue({ State: "running" })
}));

describe("mouse actions", () => {
  beforeEach(() => vi.resetAllMocks());

  it("builds a bounded absolute click sequence", () => {
    expect(qmpEventsForTest({
      nameOrUuid: "vm",
      action: "click",
      x: 0.5,
      y: 0.25,
      button: "left"
    })).toEqual([
      { type: "abs", data: { axis: "x", value: 16384 } },
      { type: "abs", data: { axis: "y", value: 8192 } },
      { type: "btn", data: { button: "left", down: true } },
      { type: "btn", data: { button: "left", down: false } }
    ]);
  });

  it("sends QMP probe and typed input event without raw passthrough", async () => {
    vi.mocked(exec.sh)
      .mockResolvedValueOnce({ stdout: '{"return":[]}', stderr: "" })
      .mockResolvedValueOnce({ stdout: '{"return":{}}', stderr: "" });
    const result = await sendMouse({ nameOrUuid: "vm", action: "move", x: 0.1, y: 0.2, backend: "qmp" });
    expect(result).toMatchObject({ ok: true, backend: "qmp", action: "move" });
    expect(vi.mocked(exec.sh).mock.calls).toHaveLength(2);
    const request = JSON.parse(vi.mocked(exec.sh).mock.calls[1][1][5]);
    expect(request.execute).toBe("input-send-event");
    expect(request.arguments.events).toHaveLength(2);
  });

  it("rejects invalid buttons and scrolls", () => {
    expect(() => qmpEventsForTest({ nameOrUuid: "vm", action: "click", x: 0, y: 0, button: "middle-ish" })).toThrow();
    expect(() => qmpEventsForTest({ nameOrUuid: "vm", action: "scroll", x: 0, y: 0 })).toThrow();
  });
});
