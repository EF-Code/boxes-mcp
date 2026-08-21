import { sh } from "./exec.js";
import { VIRSH, commonArgsFor, URIS, argsForDomain } from "./virsh.js";
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
  uri?: string;    // libvirt connection the domain was found on
}

export interface SnapshotSummary {
  name: string;
  current: boolean;
  creationTime?: string;
  description?: string;
}

// Parse `virsh list --all` output. Names may contain spaces (e.g.
// "Kali Live"), so column boundaries are taken from the header line rather
// than split on whitespace.
export function parseVirshList(text: string): DomainSummary[] {
  const lines = text.split("\n");
  const out: DomainSummary[] = [];
  const headerIdx = lines.findIndex(l => l.includes("Name") && l.includes("State"));
  if (headerIdx >= 0) {
    const header = lines[headerIdx];
    const nameStart = header.indexOf("Name");
    const stateStart = header.indexOf("State");
    for (const line of lines.slice(headerIdx + 1)) {
      if (!line.trim() || line.match(/^-+$/)) continue;
      const id = line.slice(0, nameStart).trim();
      const name = line.slice(nameStart, stateStart).trim();
      const state = line.slice(stateStart).trim();
      if (!name) continue;
      out.push({
        id: id && id !== "-" ? id : undefined,
        name,
        uuid: "",
        state: (state || "unknown") as DomainState
      });
    }
    return out;
  }
  // Fallback for unexpected formats:
  //  3   ubuntu-24.04     running
  //  -   win10            shut off
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("Id ") || line.match(/^-+$/)) continue;
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
  const seen = new Set<string>();
  const out: DomainSummary[] = [];
  for (const uri of URIS) {
    let stdout: string;
    try {
      ({ stdout } = await sh(VIRSH, [...commonArgsFor(uri), "list", "--all"]));
    } catch {
      continue; // connection unavailable; skip it
    }
    const basic = parseVirshList(stdout);
    for (const d of basic) {
      d.uri = uri;
      try {
        const { stdout: uuid } = await sh(VIRSH, [...commonArgsFor(uri), "domuuid", d.name]);
        d.uuid = uuid.trim();
      } catch {
        d.uuid = "";
      }
      const key = d.uuid || `${uri}:${d.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}

export async function domainInfo(nameOrUuid: string) {
  const { stdout } = await sh(VIRSH, [...(await argsForDomain(nameOrUuid)), "dominfo", nameOrUuid]);
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
  await sh(VIRSH, [...(await argsForDomain(nameOrUuid)), "start", nameOrUuid]);
  return { ok: true };
}

export async function shutdownDomain(nameOrUuid: string, force = false) {
  if (force) {
    await sh(VIRSH, [...(await argsForDomain(nameOrUuid)), "destroy", nameOrUuid]);
  } else {
    await sh(VIRSH, [...(await argsForDomain(nameOrUuid)), "shutdown", nameOrUuid]);
  }
  return { ok: true };
}

export async function rebootDomain(nameOrUuid: string) {
  await sh(VIRSH, [...(await argsForDomain(nameOrUuid)), "reboot", nameOrUuid]);
  return { ok: true };
}

export async function suspendDomain(nameOrUuid: string) {
  await sh(VIRSH, [...(await argsForDomain(nameOrUuid)), "suspend", nameOrUuid]);
  return { ok: true };
}

export async function resumeDomain(nameOrUuid: string) {
  await sh(VIRSH, [...(await argsForDomain(nameOrUuid)), "resume", nameOrUuid]);
  return { ok: true };
}

export async function undefineDomain(nameOrUuid: string, keepStorage = true) {
  const args = [...(await argsForDomain(nameOrUuid)), "undefine", nameOrUuid];
  if (keepStorage) args.push("--keep-nvram");
  await sh(VIRSH, args);
  return { ok: true };
}

export async function listSnapshots(nameOrUuid: string): Promise<SnapshotSummary[]> {
  const { stdout } = await sh(VIRSH, [...(await argsForDomain(nameOrUuid)), "snapshot-list", nameOrUuid, "--tree"]);
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
  const args = [...(await argsForDomain(nameOrUuid)), "snapshot-create-as", nameOrUuid, snapName];
  if (description) args.push("--description", description);
  await sh(VIRSH, args);
  return { ok: true };
}

export async function revertSnapshot(nameOrUuid: string, snapName: string) {
  await sh(VIRSH, [...(await argsForDomain(nameOrUuid)), "snapshot-revert", nameOrUuid, snapName]);
  return { ok: true };
}

export async function deleteSnapshot(nameOrUuid: string, snapName: string) {
  await sh(VIRSH, [...(await argsForDomain(nameOrUuid)), "snapshot-delete", nameOrUuid, "--snapshotname", snapName]);
  return { ok: true };
}

export async function displayAddress(nameOrUuid: string) {
  const { stdout } = await sh(VIRSH, [...(await argsForDomain(nameOrUuid)), "domdisplay", nameOrUuid]);
  return { display: stdout.trim() }; // e.g. spice://127.0.0.1:5900 or vnc://...
}

/** Return active domain XML to internal capability parsers; callers must not expose it. */
export async function domainXml(nameOrUuid: string): Promise<string> {
  const { stdout } = await sh(VIRSH, [...(await argsForDomain(nameOrUuid)), "dumpxml", nameOrUuid]);
  return stdout;
}
