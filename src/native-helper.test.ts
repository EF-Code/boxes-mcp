import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const helperPath = join(process.cwd(), "native", "boxes-spice-helper");
const suite = existsSync(helperPath) ? describe : describe.skip;

function runHelper(line: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, [], { shell: false, stdio: ["pipe", "pipe", "ignore"] });
    let buffer = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("native helper test timed out"));
    }, 5_000);
    const finish = (callback: () => void): void => {
      clearTimeout(timer);
      callback();
      if (!child.killed) child.kill();
    };
    child.on("error", error => finish(() => reject(error)));
    child.stdout.on("data", chunk => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const response = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>;
      finish(() => resolve(response));
    });
    child.stdin.end(`${line}\n`);
  });
}

suite("native SPICE helper local process boundary", () => {
  it("returns a typed error for malformed JSONL input", async () => {
    await expect(runHelper("not-json")).resolves.toMatchObject({
      version: 1, ok: false, error: { code: "INVALID_ARGUMENT" }
    });
  });

  it("keeps status framing deterministic when no SPICE server is present", async () => {
    const response = await runHelper(JSON.stringify({
      version: 1,
      id: "status-check",
      operation: "status",
      domain: "explicit-test-domain",
      display: { uri: "spice://127.0.0.1:1" },
      arguments: {}
    }));
    expect(response).toMatchObject({ version: 1, id: "status-check" });
    expect(typeof response.ok).toBe("boolean");
    if (response.ok === false) expect(response.error).toMatchObject({ code: "SPICE_UNAVAILABLE" });
    if (response.ok === true) expect(response.result).toMatchObject({ mainChannel: expect.any(String) });
  });
});
