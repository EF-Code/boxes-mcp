// Shared libvirt/virsh connection constants.
//
// Both the lifecycle helpers (libvirt.ts) and the input/guest-agent helpers
// (input.ts, guestagent.ts) need to construct `virsh -c <uri> ...` argument
// arrays. Centralising the URI and the common prefix avoids drift between
// modules and keeps a single place that honours the LIBVIRT_URI env var.
//
// LIBVIRT_URI may contain a comma-separated list of URIs. Every URI is
// scanned when listing domains, and per-domain operations resolve the owning
// URI automatically. The default covers both the system connection
// (virt-manager) and the user session connection (GNOME Boxes).

import { sh } from "./exec.js";

export const VIRSH = "virsh";

function parseUris(raw: string | undefined): string[] {
  const uris = (raw || "")
    .split(",")
    .map(u => u.trim())
    .filter(Boolean);
  return uris.length > 0 ? uris : ["qemu:///system", "qemu:///session"];
}

export const URIS: string[] = parseUris(process.env.LIBVIRT_URI);

export const DEFAULT_URI = URIS[0];

/**
 * Build the common `virsh -c <uri>` argument prefix used by every command.
 */
export function commonArgs(): string[] {
  return ["-c", DEFAULT_URI];
}

export function commonArgsFor(uri: string): string[] {
  return ["-c", uri];
}

const domainUriCache = new Map<string, string>();

/**
 * Resolve which configured URI owns a domain. UUIDs are globally unique and
 * names are unique within a connection, so probing `dominfo` on each URI in
 * order is sufficient. Results are cached for the process lifetime.
 */
export async function resolveDomainUri(nameOrUuid: string): Promise<string> {
  const cached = domainUriCache.get(nameOrUuid);
  if (cached) return cached;
  for (const uri of URIS) {
    try {
      await sh(VIRSH, [...commonArgsFor(uri), "dominfo", nameOrUuid]);
      domainUriCache.set(nameOrUuid, uri);
      return uri;
    } catch {
      // not on this connection; try the next one
    }
  }
  return DEFAULT_URI;
}

export async function argsForDomain(nameOrUuid: string): Promise<string[]> {
  return commonArgsFor(await resolveDomainUri(nameOrUuid));
}
