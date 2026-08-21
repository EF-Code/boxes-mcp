import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SETUP_CLIENTS = [
  "codex",
  "claude",
  "openclaw",
  "antigravity",
  "gemini",
  "opencode",
  "cursor",
  "windsurf",
  "vscode",
  "pi",
  "cline",
  "zed",
  "goose"
] as const;

export type SetupClient = (typeof SETUP_CLIENTS)[number];
type SetupRequest = "auto" | "all" | "generic" | SetupClient;

export interface SetupServerConfig {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface SetupPlan {
  clients: SetupClient[];
  configPaths: Record<SetupClient, string>;
  entrypoint: string;
  projectRoot: string;
  server: SetupServerConfig;
}

export interface SetupEnvironmentOptions {
  inputBackend?: "auto" | "qmp" | "spice";
  libvirtUri?: string;
  spiceHelper?: string;
  transferRoot?: string;
}

interface SetupPlanOptions extends SetupEnvironmentOptions {
  commandAvailability?: Partial<Record<SetupClient, boolean>>;
  entrypoint?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
  projectRoot?: string;
  requestedClient?: SetupRequest;
}

interface SetupOptions extends SetupEnvironmentOptions {
  dryRun: boolean;
  help: boolean;
  requestedClient: SetupRequest;
}

type JsonObject = Record<string, unknown>;

const PACKAGE_NAME = "boxes-mcp";
const SERVER_NAME = "boxes";

export function createStdioServerConfig(
  entrypoint: string,
  projectRoot: string,
  options: SetupEnvironmentOptions = {},
  platform: NodeJS.Platform = process.platform
): SetupServerConfig {
  const env = createServerEnvironment(options);
  if (isNpxEntrypoint(entrypoint)) {
    return {
      command: platform === "win32" ? "npx.cmd" : "npx",
      args: ["--yes", `${PACKAGE_NAME}@${readPackageVersion(projectRoot, entrypoint) ?? "latest"}`],
      cwd: process.cwd(),
      env
    };
  }

  if (isInstalledPackageEntrypoint(entrypoint)) {
    return {
      command: platform === "win32" ? `${PACKAGE_NAME}.cmd` : PACKAGE_NAME,
      args: [],
      cwd: process.cwd(),
      env
    };
  }

  return {
    command: process.execPath,
    args: [entrypoint],
    cwd: projectRoot,
    env
  };
}

export function buildSetupPlan(options: SetupPlanOptions = {}): SetupPlan {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const setupHome = resolve(options.home ?? setupHomeFromEnvironment(env));
  const entrypoint = normalizeEntrypoint(
    resolve(
      options.entrypoint ??
        process.argv[1] ??
        fileURLToPath(new URL("./index.js", import.meta.url))
    )
  );
  const projectRoot = resolve(
    options.projectRoot ?? findPackageRoot(entrypoint) ?? dirname(dirname(entrypoint))
  );
  const setupEnvironment = environmentOptions(env, options);

  return {
    clients: selectClients(options.requestedClient ?? "auto", options.commandAvailability),
    configPaths: getConfigPaths(setupHome, platform, env),
    entrypoint,
    projectRoot,
    server: createStdioServerConfig(entrypoint, projectRoot, setupEnvironment, platform)
  };
}

export function renderCodexConfig(server: SetupServerConfig): string {
  const lines = [
    "# Added by boxes-mcp setup.",
    "[mcp_servers.boxes]",
    `command = ${tomlString(server.command)}`,
    `args = ${tomlArray(server.args)}`,
    `cwd = ${tomlString(server.cwd)}`
  ];
  if (Object.keys(server.env).length > 0) {
    lines.push("", "[mcp_servers.boxes.env]");
    for (const [key, value] of Object.entries(server.env)) {
      lines.push(`${key} = ${tomlString(value)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderClaudeConfig(server: SetupServerConfig): JsonObject {
  return { type: "stdio", command: server.command, args: server.args, env: server.env };
}

export function renderOpenClawConfig(server: SetupServerConfig): JsonObject {
  return { command: server.command, args: server.args, cwd: server.cwd, env: server.env };
}

export function renderStandardStdioConfig(server: SetupServerConfig): JsonObject {
  return { command: server.command, args: server.args, env: server.env };
}

export function renderOpenCodeConfig(server: SetupServerConfig): JsonObject {
  return {
    type: "local",
    command: [server.command, ...server.args],
    cwd: server.cwd,
    environment: server.env,
    enabled: true
  };
}

export function renderVsCodeConfig(server: SetupServerConfig): JsonObject {
  return { type: "stdio", command: server.command, args: server.args, env: server.env };
}

export function renderPiConfig(server: SetupServerConfig): JsonObject {
  return {
    command: server.command,
    args: server.args,
    transport: "stdio",
    lifecycle: "lazy",
    env: server.env
  };
}

export function renderClineConfig(server: SetupServerConfig): JsonObject {
  return { command: server.command, args: server.args, env: server.env, transportType: "stdio" };
}

export function renderGooseConfig(server: SetupServerConfig): string {
  const lines = [
    "  boxes:",
    "    name: \"boxes\"",
    "    type: \"stdio\"",
    "    enabled: true",
    `    cmd: ${yamlString(server.command)}`,
    "    args:"
  ];
  if (server.args.length === 0) lines.push("      []");
  else for (const arg of server.args) lines.push(`      - ${yamlString(arg)}`);
  lines.push("    envs:");
  if (Object.keys(server.env).length === 0) lines.push("      {}");
  else for (const [key, value] of Object.entries(server.env)) lines.push(`      ${key}: ${yamlString(value)}`);
  lines.push("    timeout: 300");
  return `${lines.join("\n")}\n`;
}

export function parseSetupOptions(args: readonly string[]): SetupOptions {
  let requestedClient: SetupRequest = "auto";
  let dryRun = false;
  let help = false;
  const environment: SetupEnvironmentOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--client") {
      const value = args[index + 1];
      if (!value) throw new Error("--client requires a value.");
      requestedClient = parseSetupRequest(value);
      index += 1;
      continue;
    }
    if (argument === "--libvirt-uri" || argument === "--input-backend" || argument === "--spice-helper" || argument === "--transfer-root") {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      if (argument === "--libvirt-uri") environment.libvirtUri = value;
      if (argument === "--input-backend") {
        if (value !== "auto" && value !== "qmp" && value !== "spice") {
          throw new Error("--input-backend must be auto, qmp, or spice.");
        }
        environment.inputBackend = value;
      }
      if (argument === "--spice-helper") environment.spiceHelper = value;
      if (argument === "--transfer-root") environment.transferRoot = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown setup option: ${argument}`);
  }

  return { requestedClient, dryRun, help, ...environment };
}

export async function runSetup(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const options = parseSetupOptions(args);
  if (options.help) {
    printSetupHelp();
    return;
  }

  const plan = buildSetupPlan({
    requestedClient: options.requestedClient,
    env,
    inputBackend: options.inputBackend,
    libvirtUri: options.libvirtUri,
    spiceHelper: options.spiceHelper,
    transferRoot: options.transferRoot
  });
  printSetupHeader(plan, options.dryRun);

  if (plan.clients.length === 0) {
    printGenericConfig(plan);
    return;
  }
  if (options.dryRun) {
    printDryRunConfigs(plan);
    return;
  }

  const failures: string[] = [];
  for (const client of plan.clients) {
    try {
      configureClient(client, plan);
      printLine(`Configured ${clientLabel(client)}.`);
      printClientNote(client);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      failures.push(`${client}: ${message}`);
      printLine(`Could not configure ${client}: ${message}`);
    }
  }

  printLine("");
  printLine("Restart the configured agent or harness so it reloads its MCP servers.");
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

export function runDoctor(): void {
  const plan = buildSetupPlan();
  printLine("boxes-mcp doctor");
  printLine(`Node: ${process.version}`);
  printLine(`Entrypoint: ${plan.entrypoint}`);
  printLine(`virsh: ${executableOnPath("virsh") ? "found" : "not found"}`);
  printLine(
    plan.clients.length > 0
      ? `Detected hosts: ${plan.clients.map(clientLabel).join(", ")}`
      : "Detected hosts: none"
  );
  printLine("Run `boxes-mcp setup` to configure detected MCP hosts.");
}

export function printSetupHelp(): void {
  printLine("Usage: boxes-mcp setup [options]");
  printLine("");
  printLine("Configure detected MCP hosts for local Boxes MCP stdio use.");
  printLine("");
  printLine("Options:");
  printLine("  --client VALUE                                      Host to configure");
  printLine(`                                                     auto, all, generic, or: ${SETUP_CLIENTS.join(", ")}`);
  printLine("  --libvirt-uri URI                                  Persist LIBVIRT_URI");
  printLine("  --input-backend VALUE                              Persist auto, qmp, or spice");
  printLine("  --spice-helper PATH                                Persist reviewed helper path");
  printLine("  --transfer-root PATH                               Persist BOXES_TRANSFER_ROOT");
  printLine("  --dry-run                                          Print changes without writing files");
  printLine("  --help                                             Show this help");
}

function createServerEnvironment(options: SetupEnvironmentOptions): Record<string, string> {
  const env: Record<string, string> = {};
  if (options.libvirtUri?.trim()) env.LIBVIRT_URI = options.libvirtUri.trim();
  if (options.inputBackend) env.BOXES_INPUT_BACKEND = options.inputBackend;
  if (options.spiceHelper?.trim()) env.BOXES_SPICE_HELPER = resolve(options.spiceHelper.trim());
  if (options.transferRoot?.trim()) env.BOXES_TRANSFER_ROOT = resolve(options.transferRoot.trim());
  return env;
}

function environmentOptions(
  env: NodeJS.ProcessEnv,
  options: SetupEnvironmentOptions
): SetupEnvironmentOptions {
  const libvirtUri = options.libvirtUri ?? firstEnvironmentValue(env, "LIBVIRT_URI");
  const inputBackend = options.inputBackend ?? firstEnvironmentValue(env, "BOXES_INPUT_BACKEND");
  const spiceHelper = options.spiceHelper ?? firstEnvironmentValue(env, "BOXES_SPICE_HELPER");
  const transferRoot = options.transferRoot ?? firstEnvironmentValue(env, "BOXES_TRANSFER_ROOT");
  if (inputBackend !== undefined && inputBackend !== "auto" && inputBackend !== "qmp" && inputBackend !== "spice") {
    throw new Error("BOXES_INPUT_BACKEND must be auto, qmp, or spice.");
  }
  return {
    libvirtUri,
    inputBackend: inputBackend as SetupEnvironmentOptions["inputBackend"],
    spiceHelper,
    transferRoot
  };
}

function setupHomeFromEnvironment(env: NodeJS.ProcessEnv): string {
  return env.BOXES_MCP_SETUP_HOME?.trim() || homedir();
}

function firstEnvironmentValue(env: NodeJS.ProcessEnv, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function getConfigPaths(
  home: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): Record<SetupClient, string> {
  const configRoot =
    platform === "win32"
      ? env.APPDATA?.trim() || join(home, "AppData", "Roaming")
      : env.XDG_CONFIG_HOME?.trim() || join(home, ".config");
  const vscodeConfigRoot = platform === "darwin" ? join(home, "Library", "Application Support") : configRoot;
  const gooseConfigRoot =
    platform === "win32"
      ? join(env.APPDATA?.trim() || join(home, "AppData", "Roaming"), "Block", "goose", "config")
      : join(configRoot, "goose");
  const clineDataRoot = env.CLINE_DATA_DIR?.trim() || join(home, ".cline", "data");

  return {
    codex: join(home, ".codex", "config.toml"),
    claude: join(home, ".claude.json"),
    openclaw: join(home, ".openclaw", "openclaw.json"),
    antigravity: join(home, ".gemini", "config", "mcp_config.json"),
    gemini: join(home, ".gemini", "settings.json"),
    opencode: join(configRoot, "opencode", "opencode.json"),
    cursor: join(home, ".cursor", "mcp.json"),
    windsurf: join(home, ".codeium", "windsurf", "mcp_config.json"),
    vscode: join(vscodeConfigRoot, "Code", "User", "mcp.json"),
    pi: join(home, ".pi", "agent", "mcp.json"),
    cline: join(clineDataRoot, "settings", "cline_mcp_settings.json"),
    zed: join(configRoot, "zed", "settings.json"),
    goose: join(gooseConfigRoot, "config.yaml")
  };
}

function selectClients(
  requestedClient: SetupRequest,
  commandAvailability?: Partial<Record<SetupClient, boolean>>
): SetupClient[] {
  if (requestedClient === "all") return [...SETUP_CLIENTS];
  if (requestedClient === "generic") return [];
  if (requestedClient !== "auto") return [requestedClient];
  return SETUP_CLIENTS.filter((client) => {
    const explicitlyAvailable = commandAvailability?.[client];
    if (explicitlyAvailable !== undefined) return explicitlyAvailable;
    return clientCommandAvailable(client);
  });
}

function clientLabel(client: SetupClient): string {
  return {
    codex: "Codex",
    claude: "Claude Code",
    openclaw: "OpenClaw",
    antigravity: "Antigravity",
    gemini: "Gemini CLI",
    opencode: "OpenCode",
    cursor: "Cursor",
    windsurf: "Windsurf",
    vscode: "VS Code",
    pi: "Pi",
    cline: "Cline",
    zed: "Zed",
    goose: "Goose"
  }[client];
}

function clientCommands(client: SetupClient): string[] {
  return {
    codex: ["codex"],
    claude: ["claude"],
    openclaw: ["openclaw"],
    antigravity: ["antigravity", "agy"],
    gemini: ["gemini"],
    opencode: ["opencode"],
    cursor: ["cursor", "cursor-agent"],
    windsurf: ["windsurf"],
    vscode: ["code", "code-insiders"],
    pi: ["pi"],
    cline: ["cline"],
    zed: ["zed"],
    goose: ["goose"]
  }[client];
}

function clientCommandAvailable(client: SetupClient): boolean {
  return clientCommands(client).some((command) => executableOnPath(command));
}

function executableOnPath(command: string): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where.exe" : "which", [command], {
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}

function configureClient(client: SetupClient, plan: SetupPlan): void {
  switch (client) {
    case "codex":
      writeCodexConfig(plan.configPaths.codex, plan.server);
      return;
    case "claude":
      updateJsonConfig(plan.configPaths.claude, ["mcpServers", SERVER_NAME], renderClaudeConfig(plan.server));
      return;
    case "openclaw":
      configureOpenClaw(plan);
      return;
    case "antigravity":
      updateJsonConfig(plan.configPaths.antigravity, ["mcpServers", SERVER_NAME], renderStandardStdioConfig(plan.server));
      return;
    case "gemini":
      updateJsonConfig(plan.configPaths.gemini, ["mcpServers", SERVER_NAME], renderStandardStdioConfig(plan.server));
      return;
    case "opencode":
      configureOpenCode(plan);
      return;
    case "cursor":
    case "windsurf":
    case "pi":
      updateJsonConfig(
        plan.configPaths[client],
        ["mcpServers", SERVER_NAME],
        client === "pi" ? renderPiConfig(plan.server) : renderStandardStdioConfig(plan.server)
      );
      return;
    case "vscode":
      configureVsCode(plan);
      return;
    case "cline":
      updateJsonConfig(plan.configPaths.cline, ["mcpServers", SERVER_NAME], renderClineConfig(plan.server));
      return;
    case "zed":
      updateJsonConfig(plan.configPaths.zed, ["context_servers", SERVER_NAME], renderStandardStdioConfig(plan.server));
      return;
    case "goose":
      updateGooseConfig(plan.configPaths.goose, plan.server);
      return;
  }
}

function configureOpenCode(plan: SetupPlan): void {
  const path = plan.configPaths.opencode;
  const root = readJsonObject(path);
  const existingMcp = root.mcp;
  if (existingMcp !== undefined && !isJsonObject(existingMcp)) throw new Error(`${path} has a non-object mcp value.`);
  const mcp = existingMcp ?? {};
  const existingServers = mcp.servers;
  if (existingServers !== undefined) {
    if (!isJsonObject(existingServers)) throw new Error(`${path} has a non-object mcp.servers value.`);
    const otherServers = Object.keys(existingServers).filter((name) => name !== SERVER_NAME);
    if (otherServers.length > 0) throw new Error(`${path} uses OpenCode's legacy mcp.servers format for other servers; migrate those entries before running setup.`);
    delete mcp.servers;
  }
  mcp[SERVER_NAME] = renderOpenCodeConfig(plan.server);
  root.mcp = mcp;
  writeTextFile(path, `${JSON.stringify(root, null, 2)}\n`);
}

function configureVsCode(plan: SetupPlan): void {
  const command = ["code", "code-insiders"].find((candidate) => executableOnPath(candidate));
  if (command) {
    try {
      execFileSync(command, ["--add-mcp", JSON.stringify({ name: SERVER_NAME, ...renderVsCodeConfig(plan.server) })], { stdio: "ignore" });
      return;
    } catch {
      // Fall back to the documented user mcp.json location below.
    }
  }
  updateJsonConfig(plan.configPaths.vscode, ["servers", SERVER_NAME], renderVsCodeConfig(plan.server));
}

function configureOpenClaw(plan: SetupPlan): void {
  const config = renderOpenClawConfig(plan.server);
  if (executableOnPath("openclaw")) {
    execFileSync("openclaw", ["mcp", "set", SERVER_NAME, JSON.stringify(config)], { stdio: "ignore" });
    return;
  }
  updateJsonConfig(plan.configPaths.openclaw, ["mcp", "servers", SERVER_NAME], config);
}

function writeCodexConfig(path: string, server: SetupServerConfig): void {
  const source = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeTextFile(path, upsertTomlTable(source, "mcp_servers.boxes", renderCodexConfig(server)));
}

function upsertTomlTable(source: string, tableName: string, replacement: string): string {
  const lines = source.split(/\r?\n/u);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]\s*$/u.exec(line)?.[1];
    if (header !== undefined) {
      skipping = header === tableName || header.startsWith(`${tableName}.`);
      if (!skipping) kept.push(line);
      continue;
    }
    if (!skipping) kept.push(line);
  }
  const prefix = kept.join("\n").replace(/\n*$/u, "");
  return `${prefix ? `${prefix}\n\n` : ""}${replacement}`;
}

function updateJsonConfig(path: string, segments: string[], value: JsonObject): void {
  const root = readJsonObject(path);
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (existing === undefined) {
      const child: JsonObject = {};
      current[segment] = child;
      current = child;
    } else if (isJsonObject(existing)) {
      current = existing;
    } else {
      throw new Error(`${path} has a non-object ${segment} value.`);
    }
  }
  const finalSegment = segments.at(-1);
  if (!finalSegment) throw new Error("A JSON configuration path is required.");
  current[finalSegment] = value;
  writeTextFile(path, `${JSON.stringify(root, null, 2)}\n`);
}

function updateGooseConfig(path: string, server: SetupServerConfig): void {
  const block = renderGooseConfig(server);
  const source = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (!source.trim()) {
    writeTextFile(path, `extensions:\n${block}`);
    return;
  }

  const lines = source.split(/\r?\n/u);
  const extensionsIndex = lines.findIndex((line) => /^extensions:\s*$/u.test(line));
  if (extensionsIndex < 0) {
    writeTextFile(path, `${source.replace(/\n*$/u, "")}\n\nextensions:\n${block}`);
    return;
  }

  const extensionEnd = findTopLevelYamlEnd(lines, extensionsIndex + 1);
  for (let index = extensionsIndex + 1; index < extensionEnd; index += 1) {
    if (/^\s{2}-\s/u.test(lines[index])) throw new Error(`${path} uses a YAML list for extensions; configure boxes manually.`);
  }
  const boxesIndex = lines.findIndex((line, index) => index > extensionsIndex && index < extensionEnd && /^  boxes:\s*$/u.test(line));
  if (boxesIndex >= 0) {
    const boxesEnd = findIndentedYamlEnd(lines, boxesIndex + 1, 2, extensionEnd);
    lines.splice(boxesIndex, boxesEnd - boxesIndex, ...block.trimEnd().split("\n"));
  } else {
    lines.splice(extensionEnd, 0, ...block.trimEnd().split("\n"));
  }
  writeTextFile(path, `${lines.join("\n").replace(/\n*$/u, "")}\n`);
}

function findTopLevelYamlEnd(lines: string[], start: number): number {
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index].trim() && !/^\s/u.test(lines[index])) return index;
  }
  return lines.length;
}

function findIndentedYamlEnd(lines: string[], start: number, minimumIndent: number, limit: number): number {
  for (let index = start; index < limit; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const indentation = line.length - line.trimStart().length;
    if (indentation <= minimumIndent) return index;
  }
  return limit;
}

function readJsonObject(path: string): JsonObject {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`${path} is not plain JSON; use the host's MCP command to add boxes.`, { cause: error });
  }
  if (!isJsonObject(parsed)) throw new Error(`${path} must contain a JSON object.`);
  return parsed;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeTextFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  backupConfigOnce(path);
  const existingMode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, content, { encoding: "utf8", mode: existingMode });
  renameSync(temporaryPath, path);
  chmodSync(path, existingMode);
}

function backupConfigOnce(path: string): void {
  if (!existsSync(path)) return;
  const backupPath = `${path}.boxes-mcp.bak`;
  if (!existsSync(backupPath)) copyFileSync(path, backupPath);
}

function printSetupHeader(plan: SetupPlan, dryRun: boolean): void {
  printLine(`boxes-mcp ${dryRun ? "setup preview" : "setup"}`);
  printLine(
    plan.clients.length > 0
      ? `Hosts: ${plan.clients.map(clientLabel).join(", ")}`
      : "Hosts: none will be configured; printing a generic MCP config"
  );
  printLine("");
}

function printDryRunConfigs(plan: SetupPlan): void {
  for (const client of plan.clients) {
    printLine(`--- ${client}: ${plan.configPaths[client]} ---`);
    if (client === "codex") printLine(renderCodexConfig(plan.server));
    else if (client === "goose") printLine(`extensions:\n${renderGooseConfig(plan.server)}`);
    else printLine(JSON.stringify(renderClientConfig(client, plan.server), null, 2));
  }
}

function renderClientConfig(
  client: Exclude<SetupClient, "codex" | "goose">,
  server: SetupServerConfig
): JsonObject {
  switch (client) {
    case "claude": return renderClaudeConfig(server);
    case "openclaw": return renderOpenClawConfig(server);
    case "antigravity":
    case "gemini":
    case "cursor":
    case "windsurf": return renderStandardStdioConfig(server);
    case "opencode": return renderOpenCodeConfig(server);
    case "vscode": return renderVsCodeConfig(server);
    case "pi": return renderPiConfig(server);
    case "cline":
    case "zed": return client === "cline" ? renderClineConfig(server) : renderStandardStdioConfig(server);
  }
}

function printGenericConfig(plan: SetupPlan): void {
  printLine("No host will be configured. Add this MCP server manually:");
  printLine(JSON.stringify({ mcpServers: { [SERVER_NAME]: { command: plan.server.command, args: plan.server.args, cwd: plan.server.cwd, env: plan.server.env } } }, null, 2));
}

function printClientNote(client: SetupClient): void {
  if (client === "pi") printLine("Pi note: enable its MCP support if it is not already configured.");
  if (client === "goose") printLine("Goose exposes this MCP server as a stdio extension.");
}

function tomlString(value: string): string { return JSON.stringify(value); }
function tomlArray(values: readonly string[]): string { return `[${values.map((value) => tomlString(value)).join(", ")}]`; }
function yamlString(value: string): string { return JSON.stringify(value); }
function printLine(value = ""): void { process.stdout.write(`${value}\n`); }

function parseSetupRequest(value: string): SetupRequest {
  const normalized = value.toLowerCase();
  if (normalized === "auto" || normalized === "all" || normalized === "generic" || SETUP_CLIENTS.includes(normalized as SetupClient)) return normalized as SetupRequest;
  throw new Error(`--client must be auto, all, generic, ${SETUP_CLIENTS.join(", ")}.`);
}

function isNpxEntrypoint(entrypoint: string): boolean {
  const normalized = entrypoint.replaceAll("\\", "/");
  return normalized.includes("/.npm/_npx/") || normalized.includes("node_modules/.bin/boxes-mcp");
}

function isInstalledPackageEntrypoint(entrypoint: string): boolean {
  return entrypoint.replaceAll("\\", "/").includes(`/node_modules/${PACKAGE_NAME}/`);
}

function normalizeEntrypoint(entrypoint: string): string {
  try { return realpathSync(entrypoint); } catch { return entrypoint; }
}

function findPackageRoot(entrypoint: string): string | undefined {
  let current = dirname(resolve(entrypoint));
  while (true) {
    const manifestPath = join(current, "package.json");
    if (existsSync(manifestPath)) {
      try {
        const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
        if (isJsonObject(parsed) && parsed.name === PACKAGE_NAME) return current;
      } catch {
        // Continue walking when an unrelated or incomplete manifest is encountered.
      }
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function readPackageVersion(projectRoot: string, entrypoint: string): string | undefined {
  const roots = [projectRoot, findPackageRoot(entrypoint)].filter(
    (value, index, values): value is string => value !== undefined && values.indexOf(value) === index
  );
  for (const root of roots) {
    try {
      const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as unknown;
      if (isJsonObject(parsed) && typeof parsed.version === "string") return parsed.version;
    } catch {
      // A source checkout or unusual launcher may not have a readable manifest.
    }
  }
  return undefined;
}
