# Claude Code MCP Server – GNOME Boxes (via libvirt)

A lightweight Model Context Protocol (MCP) server that lets Claude Code manage virtual machines created/managed by **GNOME Boxes** (which uses **libvirt/QEMU** under the hood). It exposes safe, task‑oriented tools for listing, starting, stopping, snapshotting, and inspecting VMs.

> Works on Ubuntu 22.04/24.04 with libvirt. Requires the user running Claude Code to be in the `libvirt` (and often `kvm`) groups.

---

## 🗂️ Project Layout

```
boxes-mcp/
├─ package.json
├─ tsconfig.json
├─ src/
│  ├─ index.ts            # MCP server entry – registers tools
│  ├─ exec.ts             # thin wrapper for running shell commands safely
│  └─ libvirt.ts          # libvirt/virsh helpers & parsers
├─ README.md
└─ systemd/
   └─ boxes-mcp.service   # optional: run server as a user service
```

---

## package.json

```json
{
  "name": "boxes-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Claude Code MCP server for GNOME Boxes (libvirt/virsh)",
  "license": "MIT",
  "scripts": {
    "build": "tsc -p .",
    "start": "node dist/src/index.js",
    "dev": "node --watch dist/src/index.js",
    "compile": "tsc -p ."
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.2.0"
  },
  "devDependencies": {
    "@types/node": "^22.7.5",
    "typescript": "^5.6.3"
  }
}
```

---

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": ".",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

---

## src/exec.ts

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export type ExecResult = { stdout: string; stderr: string };

export async function sh(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<ExecResult> {
  const { timeoutMs = 60_000, env = process.env } = opts;
  const { stdout, stderr } = await pexec(cmd, args, {
    timeout: timeoutMs,
    env,
    maxBuffer: 10 * 1024 * 1024
  });
  return { stdout: stdout.toString(), stderr: stderr?.toString() ?? "" };
}
```

---

## src/libvirt.ts

```ts
import { sh } from "./exec.js";

export type DomainState =
  | "running"
  | "paused"
  | "shut off"
  | "pmsuspended"
  | "crashed"
  | "unknown";

export interface DomainSummary {
  id?: string;     // may be '-' when shut off
  name: string;
  uuid: string;
  state: DomainState;
}

export interface SnapshotSummary {
  name: string;
  current: boolean;
  creationTime?: string;
  description?: string;
}

const VIRSH = "virsh";
const DEFAULT_URI = process.env.LIBVIRT_URI || "qemu:///system";

function commonArgs() {
  return ["-c", DEFAULT_URI];
}

// Parse `virsh list --all` output
export function parseVirshList(text: string): DomainSummary[] {
  const lines = text.split("\n").map(l => l.trim());
  const out: DomainSummary[] = [];
  for (const line of lines) {
    if (!line || line.startsWith("Id ") || line.startsWith("-") || line.startsWith("---")) continue;
    // Formats:
    //  3   ubuntu-24.04     running
    //  -   win10            shut off
    const m = line.match(/^(\S+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    const id = m[1] !== "-" ? m[1] : undefined;
    const name = m[2];
    const state = (m[3] || "unknown") as DomainState;
    out.push({ id, name, uuid: "", state });
  }
  return out;
}

export async function listDomains(): Promise<DomainSummary[]> {
  const { stdout } = await sh(VIRSH, [...commonArgs(), "list", "--all"]);
  const basic = parseVirshList(stdout);
  // enrich with UUIDs
  for (const d of basic) {
    try {
      const { stdout: uuid } = await sh(VIRSH, [...commonArgs(), "domuuid", d.name]);
      d.uuid = uuid.trim();
    } catch {
      d.uuid = "";
    }
  }
  return basic;
}

export async function domainInfo(nameOrUuid: string) {
  const { stdout } = await sh(VIRSH, [...commonArgs(), "dominfo", nameOrUuid]);
  const info: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > -1) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      info[k] = v;
    }
  }
  return info; // includes State, CPU(s), Max memory, Used memory, Autostart, etc.
}

export async function startDomain(nameOrUuid: string) {
  await sh(VIRSH, [...commonArgs(), "start", nameOrUuid]);
  return { ok: true };
}

export async function shutdownDomain(nameOrUuid: string, force = false) {
  if (force) {
    await sh(VIRSH, [...commonArgs(), "destroy", nameOrUuid]);
  } else {
    await sh(VIRSH, [...commonArgs(), "shutdown", nameOrUuid]);
  }
  return { ok: true };
}

export async function rebootDomain(nameOrUuid: string) {
  await sh(VIRSH, [...commonArgs(), "reboot", nameOrUuid]);
  return { ok: true };
}

export async function suspendDomain(nameOrUuid: string) {
  await sh(VIRSH, [...commonArgs(), "suspend", nameOrUuid]);
  return { ok: true };
}

export async function resumeDomain(nameOrUuid: string) {
  await sh(VIRSH, [...commonArgs(), "resume", nameOrUuid]);
  return { ok: true };
}

export async function undefineDomain(nameOrUuid: string, keepStorage = true) {
  const args = [...commonArgs(), "undefine", nameOrUuid];
  if (keepStorage) args.push("--keep-nvram");
  await sh(VIRSH, args);
  return { ok: true };
}

export async function listSnapshots(nameOrUuid: string): Promise<SnapshotSummary[]> {
  const { stdout } = await sh(VIRSH, [...commonArgs(), "snapshot-list", nameOrUuid, "--tree"]);
  // Example row: "- test-snap                       2024-10-01 12:00:00 +0000"
  const lines = stdout.split("\n").filter(Boolean);
  const snaps: SnapshotSummary[] = [];
  for (const line of lines) {
    if (line.startsWith("Name")) continue;
    const m = line.trim().match(/^(\*?)\s*([^\s]+)\s+(\d{4}-\d{2}-\d{2}[^\n]*)?$/);
    if (m) {
      snaps.push({ name: m[2], current: m[1] === "*", creationTime: m[3] });
    }
  }
  return snaps;
}

export async function createSnapshot(nameOrUuid: string, snapName: string, description?: string) {
  const args = [...commonArgs(), "snapshot-create-as", nameOrUuid, snapName];
  if (description) args.push("--description", description);
  await sh(VIRSH, args);
  return { ok: true };
}

export async function revertSnapshot(nameOrUuid: string, snapName: string) {
  await sh(VIRSH, [...commonArgs(), "snapshot-revert", nameOrUuid, snapName]);
  return { ok: true };
}

export async function deleteSnapshot(nameOrUuid: string, snapName: string) {
  await sh(VIRSH, [...commonArgs(), "snapshot-delete", nameOrUuid, "--snapshotname", snapName]);
  return { ok: true };
}

export async function displayAddress(nameOrUuid: string) {
  const { stdout } = await sh(VIRSH, [...commonArgs(), "domdisplay", nameOrUuid]);
  return { display: stdout.trim() }; // e.g. spice://127.0.0.1:5900 or vnc://...
}
```

---

## src/index.ts

```ts
#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  listDomains,
  domainInfo,
  startDomain,
  shutdownDomain,
  rebootDomain,
  suspendDomain,
  resumeDomain,
  undefineDomain,
  listSnapshots,
  createSnapshot,
  revertSnapshot,
  deleteSnapshot,
  displayAddress
} from "./libvirt.js";

const server = new Server(
  {
    name: "boxes-mcp",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.tool("boxes.list", "List all libvirt domains (VMs) managed by GNOME Boxes/libvirt", {
  inputSchema: { type: "object", properties: {} }
}, async () => {
  const vms = await listDomains();
  return { content: [{ type: "json", json: vms }] };
});

server.tool("boxes.info", "Get detailed domain info", {
  inputSchema: {
    type: "object",
    required: ["nameOrUuid"],
    properties: {
      nameOrUuid: { type: "string", description: "Domain name or UUID" }
    }
  }
}, async ({ nameOrUuid }) => {
  const info = await domainInfo(nameOrUuid);
  return { content: [{ type: "json", json: info }] };
});

server.tool("boxes.start", "Start a domain (VM)", {
  inputSchema: {
    type: "object",
    required: ["nameOrUuid"],
    properties: { nameOrUuid: { type: "string" } }
  }
}, async ({ nameOrUuid }) => {
  const r = await startDomain(nameOrUuid);
  return { content: [{ type: "json", json: r }] };
});

server.tool("boxes.shutdown", "Shutdown/Power off a domain (graceful by default)", {
  inputSchema: {
    type: "object",
    required: ["nameOrUuid"],
    properties: {
      nameOrUuid: { type: "string" },
      force: { type: "boolean", description: "If true, force off (destroy)", default: false }
    }
  }
}, async ({ nameOrUuid, force = false }) => {
  const r = await shutdownDomain(nameOrUuid, force);
  return { content: [{ type: "json", json: r }] };
});

server.tool("boxes.reboot", "Reboot a running domain", {
  inputSchema: {
    type: "object",
    required: ["nameOrUuid"],
    properties: { nameOrUuid: { type: "string" } }
  }
}, async ({ nameOrUuid }) => {
  const r = await rebootDomain(nameOrUuid);
  return { content: [{ type: "json", json: r }] };
});

server.tool("boxes.suspend", "Suspend a running domain", {
  inputSchema: { type: "object", required: ["nameOrUuid"], properties: { nameOrUuid: { type: "string" } } }
}, async ({ nameOrUuid }) => ({ content: [{ type: "json", json: await suspendDomain(nameOrUuid) }] }));

server.tool("boxes.resume", "Resume a suspended domain", {
  inputSchema: { type: "object", required: ["nameOrUuid"], properties: { nameOrUuid: { type: "string" } } }
}, async ({ nameOrUuid }) => ({ content: [{ type: "json", json: await resumeDomain(nameOrUuid) }] }));

server.tool("boxes.undefine", "Undefine a domain (remove from libvirt). Storage is NOT deleted.", {
  inputSchema: {
    type: "object",
    required: ["nameOrUuid"],
    properties: {
      nameOrUuid: { type: "string" },
      keepStorage: { type: "boolean", default: true }
    }
  }
}, async ({ nameOrUuid, keepStorage = true }) => {
  const r = await undefineDomain(nameOrUuid, keepStorage);
  return { content: [{ type: "json", json: r }] };
});

server.tool("boxes.snapshots.list", "List snapshots for a domain", {
  inputSchema: { type: "object", required: ["nameOrUuid"], properties: { nameOrUuid: { type: "string" } } }
}, async ({ nameOrUuid }) => ({ content: [{ type: "json", json: await listSnapshots(nameOrUuid) }] }));

server.tool("boxes.snapshots.create", "Create a snapshot for a domain", {
  inputSchema: {
    type: "object",
    required: ["nameOrUuid", "snapshot"],
    properties: {
      nameOrUuid: { type: "string" },
      snapshot: { type: "string" },
      description: { type: "string" }
    }
  }
}, async ({ nameOrUuid, snapshot, description }) => ({ content: [{ type: "json", json: await createSnapshot(nameOrUuid, snapshot, description) }] }));

server.tool("boxes.snapshots.revert", "Revert a domain to a snapshot", {
  inputSchema: { type: "object", required: ["nameOrUuid", "snapshot"], properties: { nameOrUuid: { type: "string" }, snapshot: { type: "string" } } }
}, async ({ nameOrUuid, snapshot }) => ({ content: [{ type: "json", json: await revertSnapshot(nameOrUuid, snapshot) }] }));

server.tool("boxes.snapshots.delete", "Delete a snapshot", {
  inputSchema: { type: "object", required: ["nameOrUuid", "snapshot"], properties: { nameOrUuid: { type: "string" }, snapshot: { type: "string" } } }
}, async ({ nameOrUuid, snapshot }) => ({ content: [{ type: "json", json: await deleteSnapshot(nameOrUuid, snapshot) }] }));

server.tool("boxes.display", "Get SPICE/VNC display address for VM (useful to open viewer)", {
  inputSchema: { type: "object", required: ["nameOrUuid"], properties: { nameOrUuid: { type: "string" } } }
}, async ({ nameOrUuid }) => ({ content: [{ type: "json", json: await displayAddress(nameOrUuid) }] }));

// Start transport
const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## README.md

````md
# boxes-mcp – Claude Code MCP for GNOME Boxes (libvirt)

This MCP server exposes libvirt/virsh operations so Claude Code can manage VMs that GNOME Boxes creates/uses. It focuses on safe, reversible actions (start/stop/snapshot/info) and avoids destructive storage ops by default.

## Requirements

- Ubuntu 22.04/24.04 with `libvirt-daemon-system`, `qemu-kvm`, `virt-manager` (optional) installed
- `virsh` available on PATH
- The user running Claude must be in `libvirt` and `kvm` groups:
  ```bash
  sudo apt install -y libvirt-daemon-system qemu-kvm virt-manager
  sudo usermod -aG libvirt,kvm "$USER"
  newgrp libvirt
````

* If your Boxes VMs are under the system libvirt instance (typical), use `qemu:///system` (default). Override via env var `LIBVIRT_URI` (e.g., `qemu:///session`).

## Install

```bash
git clone https://github.com/your-org/boxes-mcp.git
cd boxes-mcp
npm install
npm run build
```

## Run

```bash
LIBVIRT_URI=qemu:///system node dist/src/index.js
```

Or as a user service (systemd unit provided below).

## Add to Claude Code

Add this to your Claude Code config (e.g. `~/.claude/config.json`):

```jsonc
{
  "mcpServers": {
    "boxes": {
      "command": "node",
      "args": ["/absolute/path/to/boxes-mcp/dist/src/index.js"],
      "env": {
        "LIBVIRT_URI": "qemu:///system"
      }
    }
  }
}
```

### Available Tools

* `boxes.list` → list all domains
* `boxes.info { nameOrUuid }`
* `boxes.start { nameOrUuid }`
* `boxes.shutdown { nameOrUuid, force? }` (force uses `virsh destroy`)
* `boxes.reboot { nameOrUuid }`
* `boxes.suspend { nameOrUuid }`
* `boxes.resume { nameOrUuid }`
* `boxes.undefine { nameOrUuid, keepStorage? }` (default keeps NVRAM; storage not deleted)
* `boxes.snapshots.list { nameOrUuid }`
* `boxes.snapshots.create { nameOrUuid, snapshot, description? }`
* `boxes.snapshots.revert { nameOrUuid, snapshot }`
* `boxes.snapshots.delete { nameOrUuid, snapshot }`
* `boxes.display { nameOrUuid }` → returns SPICE/VNC URI (e.g., `spice://127.0.0.1:5900`)

> **Tip:** In GNOME Boxes, VMs typically appear as libvirt domains. Names often match what you see in Boxes. You can always address by UUID.

## Security Notes

* The server shells out to `virsh` and respects `LIBVIRT_URI`. It does **not** accept arbitrary commands.
* It avoids deleting storage. If you truly need `undefine --remove-all-storage`, fork and add with care.
* Consider placing the server behind a wrapper that drops capabilities if you run it as a service.

## Troubleshooting

* If `virsh list --all` shows no domains, try switching URI: `LIBVIRT_URI=qemu:///session`.
* If you get `permission denied`, ensure your user is in `libvirt` and `kvm` groups and re-login.
* For Boxes-created VMs that don't show, open `virt-manager` and confirm which connection they live under.

## systemd (user) service

Install as a **user** unit so it starts on login:

```bash
mkdir -p ~/.config/systemd/user
cp systemd/boxes-mcp.service ~/.config/systemd/user/
sed -i "s|/path/to/|$HOME/|g" ~/.config/systemd/user/boxes-mcp.service
systemctl --user daemon-reload
systemctl --user enable --now boxes-mcp
journalctl --user -fu boxes-mcp
```

```
[Unit]
Description=Boxes MCP (Claude Code)
After=default.target

[Service]
Type=simple
Environment=LIBVIRT_URI=qemu:///system
ExecStart=%h/boxes-mcp/node_modules/.bin/node %h/boxes-mcp/dist/src/index.js
Restart=on-failure

[Install]
WantedBy=default.target
```

## Roadmap

* Optional creation/import helpers via `virt-install` / `gnome-boxes --import` (when present)
* Network/port-forward discovery (`virsh domifaddr`, `virsh net-list`, etc.)
* Disk usage & pool info (`virsh vol-list --pool default`)

```
```

