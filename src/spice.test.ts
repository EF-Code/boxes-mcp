import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { callSpiceHelper, spiceHelperConfigured } from "./spice.js";

describe("SPICE helper boundary", () => {
  let tempDirectory: string | undefined;

  afterEach(async () => {
    delete process.env.BOXES_SPICE_HELPER;
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
    tempDirectory = undefined;
  });

  it("is disabled unless an executable helper is explicitly configured", async () => {
    delete process.env.BOXES_SPICE_HELPER;
    expect(spiceHelperConfigured()).toBe(false);
    await expect(callSpiceHelper("clipboard.read", "vm", {
      display: "spice://127.0.0.1:5900",
      protocol: "spice"
    }, {})).rejects.toMatchObject({ code: "SPICE_UNAVAILABLE" });
  });

  it("frames a bounded request and correlates the helper response", async () => {
    tempDirectory = await mkdtemp(join("/tmp", "boxes-mcp-spice-test-"));
    const helper = join(tempDirectory, "helper.mjs");
    await writeFile(helper, `#!/bin/sh
IFS= read -r request
id=$(printf '%s' "$request" | sed -n 's/.*"id":"\\([^\"]*\\)".*/\\1/p')
operation=$(printf '%s' "$request" | sed -n 's/.*"operation":"\\([^\"]*\\)".*/\\1/p')
printf '{"version":1,"id":"%s","ok":true,"result":{"operation":"%s"}}\\n' "$id" "$operation"
`);
    await chmod(helper, 0o700);
    process.env.BOXES_SPICE_HELPER = helper;
    await expect(callSpiceHelper("mouse", "vm", {
      display: "spice://127.0.0.1:5900", protocol: "spice", host: "127.0.0.1", port: 5900
    }, { action: "move" })).resolves.toEqual({ operation: "mouse" });
  });

  it("maps helper capability errors without exposing raw protocol access", async () => {
    tempDirectory = await mkdtemp(join("/tmp", "boxes-mcp-spice-test-"));
    const helper = join(tempDirectory, "helper.mjs");
    await writeFile(helper, `#!/bin/sh
IFS= read -r request
id=$(printf '%s' "$request" | sed -n 's/.*"id":"\\([^\"]*\\)".*/\\1/p')
printf '{"version":1,"id":"%s","ok":false,"error":{"code":"SPICE_AGENT_DISCONNECTED","message":"agent unavailable"}}\\n' "$id"
`);
    await chmod(helper, 0o700);
    process.env.BOXES_SPICE_HELPER = helper;
    await expect(callSpiceHelper("clipboard.read", "vm", {
      display: "spice://127.0.0.1:5900", protocol: "spice", host: "127.0.0.1", port: 5900
    }, {})).rejects.toMatchObject({ code: "SPICE_AGENT_DISCONNECTED" });
  });
});
