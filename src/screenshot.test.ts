import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as exec from "./exec.js";
import { captureScreenshot, imageTypeForTest } from "./screenshot.js";

vi.mock("./exec.js");
vi.mock("./libvirt.js", () => ({
  requireRunningDomain: vi.fn().mockResolvedValue({ State: "running" })
}));

describe("screenshot adapter", () => {
  beforeEach(() => vi.resetAllMocks());

  it("detects supported image signatures", () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(imageTypeForTest(png)).toEqual({ mimeType: "image/png", width: 640, height: 480 });
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
    const entries = await readFile(join(base, "does-not-exist")).catch(() => undefined);
    expect(entries).toBeUndefined();
    await rm(base, { recursive: true, force: true });
    delete process.env.BOXES_ARTIFACT_DIR;
  });
});
