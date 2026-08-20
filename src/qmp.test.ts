import { beforeEach, describe, expect, it, vi } from "vitest";
import * as exec from "./exec.js";
import { absoluteCoordinate, pixelCoordinate, qmpExecute } from "./qmp.js";

vi.mock("./exec.js");

describe("QMP adapter", () => {
  beforeEach(() => vi.resetAllMocks());

  it("normalizes coordinates and builds a fixed monitor command", async () => {
    vi.mocked(exec.sh).mockResolvedValueOnce({ stdout: '{"return":[]}', stderr: "" });
    expect(absoluteCoordinate(0.5)).toBe(16384);
    expect(pixelCoordinate(50, 100)).toBe(16384);
    await qmpExecute("vm", "query-mice");
    const args = vi.mocked(exec.sh).mock.calls[0][1];
    expect(args.slice(0, 5)).toEqual(["-c", "qemu:///system", "qemu-monitor-command", "vm", "--pretty"]);
    expect(JSON.parse(args[5])).toEqual({ execute: "query-mice", arguments: {} });
  });

  it("maps QMP command errors to stable codes", async () => {
    vi.mocked(exec.sh).mockResolvedValueOnce({
      stdout: '{"error":{"class":"CommandNotFound","desc":"unknown command"}}',
      stderr: ""
    });
    await expect(qmpExecute("vm", "query-mice")).rejects.toMatchObject({ code: "QMP_COMMAND_UNSUPPORTED" });
  });

  it("rejects malformed QMP output", async () => {
    vi.mocked(exec.sh).mockResolvedValueOnce({ stdout: "not-json", stderr: "" });
    await expect(qmpExecute("vm", "query-mice")).rejects.toMatchObject({ code: "QMP_UNAVAILABLE" });
  });
});
