import { beforeEach, describe, expect, it, vi } from "vitest";
import * as exec from "./exec.js";
import { qmpEventsForTest, sendMouse } from "./mouse.js";
import * as display from "./display.js";

vi.mock("./exec.js");
vi.mock("./display.js", () => ({ displayEndpoint: vi.fn() }));
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
      .mockResolvedValueOnce({ stdout: '{"return":[{"name":"input-send-event"}]}', stderr: "" })
      .mockResolvedValueOnce({ stdout: '{"return":[{"name":"QEMU USB Tablet","absolute":true}]}', stderr: "" })
      .mockResolvedValueOnce({ stdout: '{"return":{}}', stderr: "" });
    vi.mocked(display.displayEndpoint).mockResolvedValue({
      display: "spice://127.0.0.1:5900", protocol: "spice", host: "127.0.0.1", port: 5900
    });
    const result = await sendMouse({ nameOrUuid: "vm", action: "move", x: 0.1, y: 0.2, backend: "qmp" });
    expect(result).toMatchObject({ ok: true, backend: "qmp", action: "move", head: 0, display: "spice://127.0.0.1:5900" });
    expect(vi.mocked(exec.sh).mock.calls).toHaveLength(3);
    const request = JSON.parse(vi.mocked(exec.sh).mock.calls[2][1][5]);
    expect(request.execute).toBe("input-send-event");
    expect(request.arguments.events).toHaveLength(2);
  });

  it("rejects invalid buttons and scrolls", () => {
    expect(() => qmpEventsForTest({ nameOrUuid: "vm", action: "click", x: 0, y: 0, button: "middle-ish" })).toThrow();
    expect(() => qmpEventsForTest({ nameOrUuid: "vm", action: "scroll", x: 0, y: 0 })).toThrow();
    expect(() => qmpEventsForTest({ nameOrUuid: "vm", action: "buttonDown", x: 0, y: 0, button: "left" })).toThrow();
    expect(() => qmpEventsForTest({ nameOrUuid: "vm", action: "move", x: Number.NaN, y: 0 })).toThrow();
    expect(() => qmpEventsForTest({ nameOrUuid: "vm", action: "move", x: Number.POSITIVE_INFINITY, y: 0 })).toThrow();
  });
});
