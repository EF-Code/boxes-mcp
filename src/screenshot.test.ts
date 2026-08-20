import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as exec from "./exec.js";
import { captureScreenshot, imageTypeForTest, listArtifactEntriesForTest, parseScreenshotRequest } from "./screenshot.js";

vi.mock("./exec.js");
vi.mock("./libvirt.js", () => ({
  requireRunningDomain: vi.fn().mockResolvedValue({ State: "running" })
}));

describe("screenshot adapter", () => {
  beforeEach(() => vi.resetAllMocks());

  afterEach(() => {
    delete process.env.BOXES_ARTIFACT_DIR;
    delete process.env.BOXES_MAX_SCREENSHOT_BYTES;
  });

  it("detects supported image signatures", () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(imageTypeForTest(png)).toEqual({ mimeType: "image/png", width: 640, height: 480 });
    expect(imageTypeForTest(Buffer.from("P6\n# test\n2 3\n255\n"))).toEqual({
      mimeType: "image/x-portable-pixmap",
      width: 2,
      height: 3
    });
    expect(() => imageTypeForTest(Buffer.from("P6\n"))).toThrow(/malformed PPM/);
  });

  it("uses a controlled temporary file and returns image data", async () => {
    const base = await mkdtemp(join("/tmp", "boxes-mcp-test-"));
    process.env.BOXES_ARTIFACT_DIR = base;
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(1, 16);
    png.writeUInt32BE(1, 20);
    vi.mocked(exec.sh).mockImplementationOnce(async (_cmd, args) => {
      const output = args[args.indexOf("--file") + 1];
      await writeFile(output, png);
      return { stdout: "", stderr: "" };
    });
    const result = await captureScreenshot({ nameOrUuid: "vm", screen: 0 });
    expect(result).toMatchObject({ mimeType: "image/png", bytes: 24, width: 1, height: 1, backend: "libvirt" });
    expect(Buffer.from(result.data, "base64")).toEqual(png);
    expect(await listArtifactEntriesForTest(base)).toEqual([]);
    await rm(base, { recursive: true, force: true });
  });

  it("uses the fixed libvirt screenshot arguments and cleans up on failure", async () => {
    const base = await mkdtemp(join("/tmp", "boxes-mcp-test-"));
    process.env.BOXES_ARTIFACT_DIR = base;
    vi.mocked(exec.sh).mockRejectedValueOnce(new Error("virsh failed"));
    await expect(captureScreenshot({ nameOrUuid: "vm", screen: 2, backend: "libvirt" }))
      .rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
    expect(vi.mocked(exec.sh).mock.calls[0]).toMatchObject([
      "virsh",
      ["-c", "qemu:///system", "screenshot", "vm", "--file", expect.stringContaining(`${base}/screenshot-`), "--screen", "2"]
    ]);
    expect(await listArtifactEntriesForTest(base)).toEqual([]);
    await rm(base, { recursive: true, force: true });
  });

  it("maps timeout and oversized artifacts to stable errors", async () => {
    const base = await mkdtemp(join("/tmp", "boxes-mcp-test-"));
    process.env.BOXES_ARTIFACT_DIR = base;
    vi.mocked(exec.sh).mockRejectedValueOnce(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }));
    await expect(captureScreenshot({ nameOrUuid: "vm" })).rejects.toMatchObject({ code: "OPERATION_TIMEOUT" });

    const png = Buffer.alloc(2048);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    process.env.BOXES_MAX_SCREENSHOT_BYTES = "1024";
    vi.mocked(exec.sh).mockImplementationOnce(async (_cmd, args) => {
      await writeFile(args[args.indexOf("--file") + 1], png);
      return { stdout: "", stderr: "" };
    });
    await expect(captureScreenshot({ nameOrUuid: "vm" })).rejects.toMatchObject({ code: "ARTIFACT_TOO_LARGE" });
    expect(await listArtifactEntriesForTest(base)).toEqual([]);
    await rm(base, { recursive: true, force: true });
  });

  it("only parses implemented screenshot backends", () => {
    expect(parseScreenshotRequest({ nameOrUuid: "vm" }).backend).toBe("auto");
    expect(() => parseScreenshotRequest({ nameOrUuid: "vm", backend: "spice" })).toThrow();
    expect(() => parseScreenshotRequest({ nameOrUuid: "vm", screen: 17 })).toThrow();
  });
});
