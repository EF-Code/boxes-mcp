import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { callSpiceHelper, closeSpiceHelper, parseSpiceMouseResult, parseSpiceStatus, SpiceHelperClient, spiceHelperConfigured } from "./spice.js";

describe("SPICE helper boundary", () => {
  let tempDirectory: string | undefined;

  afterEach(async () => {
    closeSpiceHelper();
    delete process.env.BOXES_SPICE_HELPER;
    delete process.env.BOXES_SPICE_OPERATION_TIMEOUT_MS;
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
    tempDirectory = undefined;
  });

  it("is disabled unless an executable helper is explicitly configured", async () => {
    delete process.env.BOXES_SPICE_HELPER;
    expect(spiceHelperConfigured()).toBe(false);
    await expect(callSpiceHelper({
      operation: "clipboard.read",
      domain: "vm",
      display: { display: "spice://127.0.0.1:5900", protocol: "spice" },
      arguments: { selection: "clipboard", maxBytes: 1024 }
    })).rejects.toMatchObject({ code: "SPICE_UNAVAILABLE" });
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
    await expect(callSpiceHelper({
      operation: "mouse",
      domain: "vm",
      display: { display: "spice://127.0.0.1:5900", protocol: "spice", host: "127.0.0.1", port: 5900 },
      arguments: { action: "move", x: 0.5, y: 0.5, coordinateSpace: "normalized" }
    })).resolves.toEqual({ operation: "mouse" });
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
    await expect(callSpiceHelper({
      operation: "clipboard.read",
      domain: "vm",
      display: { display: "spice://127.0.0.1:5900", protocol: "spice", host: "127.0.0.1", port: 5900 },
      arguments: { selection: "clipboard", maxBytes: 1024 }
    })).rejects.toMatchObject({ code: "SPICE_AGENT_DISCONNECTED" });
  });

  it("keeps one helper process for correlated requests", async () => {
    tempDirectory = await mkdtemp(join("/tmp", "boxes-mcp-spice-test-"));
    const helper = join(tempDirectory, "helper.sh");
    await writeFile(helper, `#!/bin/sh
while IFS= read -r request; do
  id=$(printf '%s' "$request" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')
  operation=$(printf '%s' "$request" | sed -n 's/.*"operation":"\\([^"]*\\)".*/\\1/p')
  printf '{"version":1,"id":"%s","ok":true,"result":{"operation":"%s"}}\\n' "$id" "$operation"
done
`);
    await chmod(helper, 0o700);
    process.env.BOXES_SPICE_HELPER = helper;
    const display = { display: "spice://127.0.0.1:5900", protocol: "spice" as const };
    await expect(callSpiceHelper({ operation: "status", domain: "vm", display, arguments: {} }))
      .resolves.toEqual({ operation: "status" });
    await expect(callSpiceHelper({
      operation: "mouse", domain: "vm", display,
      arguments: { action: "move", x: 0.1, y: 0.2, coordinateSpace: "normalized" }
    })).resolves.toEqual({ operation: "mouse" });
  });

  it("fails pending work on timeout, malformed frames, and helper crashes", async () => {
    tempDirectory = await mkdtemp(join("/tmp", "boxes-mcp-spice-test-"));
    const timeoutHelper = join(tempDirectory, "timeout.sh");
    await writeFile(timeoutHelper, "#!/bin/sh\nIFS= read -r request\nsleep 1\n");
    await chmod(timeoutHelper, 0o700);
    process.env.BOXES_SPICE_HELPER = timeoutHelper;
    process.env.BOXES_SPICE_OPERATION_TIMEOUT_MS = "100";
    const operation = {
      operation: "status" as const,
      domain: "vm",
      display: { display: "spice://127.0.0.1:5900", protocol: "spice" as const },
      arguments: {}
    };
    await expect(callSpiceHelper(operation)).rejects.toMatchObject({ code: "OPERATION_TIMEOUT" });

    const malformedHelper = join(tempDirectory, "malformed.sh");
    await writeFile(malformedHelper, "#!/bin/sh\nIFS= read -r request\nprintf 'not-json\\n'\n");
    await chmod(malformedHelper, 0o700);
    process.env.BOXES_SPICE_HELPER = malformedHelper;
    await expect(callSpiceHelper(operation)).rejects.toMatchObject({ code: "SPICE_UNAVAILABLE" });

    const crashHelper = join(tempDirectory, "crash.sh");
    await writeFile(crashHelper, "#!/bin/sh\nIFS= read -r request\nexit 1\n");
    await chmod(crashHelper, 0o700);
    process.env.BOXES_SPICE_HELPER = crashHelper;
    await expect(callSpiceHelper(operation)).rejects.toMatchObject({ code: "SPICE_UNAVAILABLE" });
  });

  it("rejects oversized helper frames", async () => {
    tempDirectory = await mkdtemp(join("/tmp", "boxes-mcp-spice-test-"));
    const helper = join(tempDirectory, "large.sh");
    await writeFile(helper, "#!/bin/sh\nIFS= read -r request\nprintf '%600s\\n' x\n");
    await chmod(helper, 0o700);
    process.env.BOXES_SPICE_HELPER = helper;
    const client = new SpiceHelperClient(512);
    await expect(client.request({
      operation: "status",
      domain: "vm",
      display: { display: "spice://127.0.0.1:5900", protocol: "spice" },
      arguments: {}
    })).rejects.toMatchObject({ code: "SPICE_UNAVAILABLE" });
    client.close();
  });

  it("validates the typed status result", () => {
    expect(parseSpiceStatus({
      mainChannel: "connected", inputsChannel: "connected", displayChannel: "disconnected",
      agentConnected: false, clipboard: false, fileTransfer: false, mouseMode: 1,
      geometryKnown: false, width: 0, height: 0
    })).toMatchObject({ displayChannel: "disconnected", geometryKnown: false });
    expect(() => parseSpiceStatus({ mainChannel: "ready" })).toThrow(/invalid/);
  });

  it("validates mouse completion and geometry evidence", () => {
    expect(parseSpiceMouseResult({ backend: "spice", completed: true, display: 0, width: 1024, height: 768 }))
      .toMatchObject({ display: 0, width: 1024, height: 768 });
    expect(() => parseSpiceMouseResult({ backend: "spice", completed: true, display: 0, width: 0, height: 768 }))
      .toThrow(/mouse/);
  });
});
