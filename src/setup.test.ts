import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSetupPlan,
  createStdioServerConfig,
  parseSetupOptions,
  renderCodexConfig,
  renderGooseConfig,
  runSetup
} from "./setup.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryHome(): string {
  const directory = mkdtempSync(join(tmpdir(), "boxes-mcp-setup-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("guided MCP setup", () => {
  it("parses explicit hosts and bounded environment options", () => {
    expect(parseSetupOptions([
      "--client", "codex", "--libvirt-uri", "qemu:///session", "--input-backend", "spice",
      "--spice-helper", "/opt/boxes-helper", "--transfer-root", "/srv/boxes-files", "--dry-run"
    ])).toEqual({
      requestedClient: "codex",
      dryRun: true,
      help: false,
      libvirtUri: "qemu:///session",
      inputBackend: "spice",
      spiceHelper: "/opt/boxes-helper",
      transferRoot: "/srv/boxes-files"
    });
  });

  it("rejects unknown hosts and backend values", () => {
    expect(() => parseSetupOptions(["--client", "unknown"])).toThrow(/--client/);
    expect(() => parseSetupOptions(["--input-backend", "shell"])).toThrow(/input-backend/);
  });

  it("uses npx for published entrypoints and preserves reviewed settings", () => {
    const server = createStdioServerConfig(
      "/home/test/.npm/_npx/hash/node_modules/boxes-mcp/dist/src/index.js",
      "/home/test/.npm/_npx/hash/node_modules/boxes-mcp",
      {
        libvirtUri: "qemu:///session",
        inputBackend: "auto",
        spiceHelper: "/opt/boxes-helper",
        transferRoot: "/srv/boxes-files"
      },
      "linux"
    );
    expect(server).toMatchObject({
      command: "npx",
      args: ["--yes", "boxes-mcp@latest"],
      env: {
        LIBVIRT_URI: "qemu:///session",
        BOXES_INPUT_BACKEND: "auto",
        BOXES_SPICE_HELPER: "/opt/boxes-helper",
        BOXES_TRANSFER_ROOT: "/srv/boxes-files"
      }
    });
  });

  it("detects an explicit host without relying on stale config files", () => {
    const home = temporaryHome();
    const plan = buildSetupPlan({
      home,
      platform: "linux",
      requestedClient: "codex",
      entrypoint: "/workspace/boxes-mcp/dist/src/index.js",
      projectRoot: "/workspace/boxes-mcp",
      env: { XDG_CONFIG_HOME: join(home, ".config") },
      libvirtUri: "qemu:///session"
    });
    expect(plan.clients).toEqual(["codex"]);
    expect(plan.configPaths.codex).toBe(join(home, ".codex", "config.toml"));
    expect(plan.server.env).toEqual({ LIBVIRT_URI: "qemu:///session" });
  });

  it("writes an atomic Codex entry, preserves it on rerun, and creates one backup", async () => {
    const home = temporaryHome();
    const env = {
      ...process.env,
      BOXES_MCP_SETUP_HOME: home,
      LIBVIRT_URI: "qemu:///session"
    };
    await runSetup(["--client", "codex"], env);
    await runSetup(["--client", "codex"], env);
    const configPath = join(home, ".codex", "config.toml");
    expect(readFileSync(configPath, "utf8")).toContain("[mcp_servers.boxes]");
    expect(readFileSync(configPath, "utf8")).toContain('LIBVIRT_URI = "qemu:///session"');
    expect(existsSync(`${configPath}.boxes-mcp.bak`)).toBe(true);
  });

  it("renders host-specific protocol entries", () => {
    const server = {
      command: "npx",
      args: ["--yes", "boxes-mcp@0.1.0"],
      cwd: "/tmp",
      env: { LIBVIRT_URI: "qemu:///session" }
    };
    expect(renderCodexConfig(server)).toContain("[mcp_servers.boxes]");
    expect(renderGooseConfig(server)).toContain("  boxes:");
    expect(renderGooseConfig(server)).toContain("LIBVIRT_URI");
  });
});
