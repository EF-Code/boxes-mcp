// Shared libvirt/virsh connection constants.
//
// Both the lifecycle helpers (libvirt.ts) and the input/guest-agent helpers
// (input.ts, guestagent.ts) need to construct `virsh -c <uri> ...` argument
// arrays. Centralising the URI and the common prefix avoids drift between
// modules and keeps a single place that honours the LIBVIRT_URI env var.

export const VIRSH = "virsh";

export const DEFAULT_URI = process.env.LIBVIRT_URI || "qemu:///system";

/**
 * Build the common `virsh -c <uri>` argument prefix used by every command.
 */
export function commonArgs(): string[] {
  return ["-c", DEFAULT_URI];
}
