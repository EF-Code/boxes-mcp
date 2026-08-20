import { sh } from "./exec.js";
import { VIRSH, commonArgs } from "./virsh.js";
import { BoxesError } from "./errors.js";

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

// Parse `virsh list --all` output
export function parseVirshList(text: string): DomainSummary[] {
  const lines = text.split("\n").map(l => l.trim());
  const out: DomainSummary[] = [];
  for (const line of lines) {
    if (!line || line.startsWith("Id ") || line.match(/^-+$/)) continue;
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

export async function requireRunningDomain(nameOrUuid: string): Promise<Record<string, string>> {
  let info: Record<string, string>;
  try {
    info = await domainInfo(nameOrUuid);
  } catch (error) {
    throw new BoxesError("DOMAIN_NOT_FOUND", `Unable to resolve domain ${nameOrUuid}`, { cause: error });
  }
  if ((info.State || "").toLowerCase() !== "running") {
    throw new BoxesError("DOMAIN_NOT_RUNNING", `Domain ${nameOrUuid} is not running`);
  }
  return info;
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

/** Return active domain XML to internal capability parsers; callers must not expose it. */
export async function domainXml(nameOrUuid: string): Promise<string> {
  const { stdout } = await sh(VIRSH, [...commonArgs(), "dumpxml", nameOrUuid]);
  return stdout;
}
