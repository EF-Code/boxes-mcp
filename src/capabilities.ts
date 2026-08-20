import { BoxesError } from "./errors.js";
import { displayEndpoint, parseDomainDisplayCapabilities, type DisplayEndpoint, type DomainDisplayCapabilities } from "./display.js";
import { probeQmp } from "./qmp.js";
import { spiceHelperConfigured, spiceHelperStatus } from "./spice.js";
import { domainXml, requireRunningDomain } from "./libvirt.js";

export type CapabilityState =
  | "unconfigured"
  | "configured"
  | "connecting"
  | "connected"
  | "agent-disconnected"
  | "capability-missing";

export interface CapabilityStatus {
  state: CapabilityState;
  reason?: string;
}

export interface BackendCapabilities {
  qmp: CapabilityStatus;
  spice: CapabilityStatus;
  clipboard: CapabilityStatus;
  fileTransfer: CapabilityStatus;
}

export interface DomainCapabilities {
  nameOrUuid: string;
  display?: DisplayEndpoint;
  domain: DomainDisplayCapabilities;
  backends: BackendCapabilities;
}

/** Resolve backend capabilities without exposing monitor paths or credentials. */
export async function discoverCapabilities(
  nameOrUuid: string,
  options: { probeQmp?: boolean; probeSpice?: boolean } = {}
): Promise<DomainCapabilities> {
  await requireRunningDomain(nameOrUuid);
  let display: DisplayEndpoint | undefined;
  try {
    display = await displayEndpoint(nameOrUuid);
  } catch (error) {
    if (!(error instanceof BoxesError) || error.code !== "UNSUPPORTED_DISPLAY") throw error;
  }

  let domain: DomainDisplayCapabilities = { hasSpiceAgentChannel: false, hasAbsolutePointer: false };
  try {
    domain = parseDomainDisplayCapabilities(await domainXml(nameOrUuid));
  } catch {
    // Display lookup and running-state validation remain useful when XML probing is unavailable.
  }

  const spiceConfigured = display?.protocol === "spice" && spiceHelperConfigured();
  let spiceStatus;
  if (options.probeSpice && spiceConfigured && display) {
    try {
      spiceStatus = await spiceHelperStatus(nameOrUuid, display);
    } catch (error) {
      if (error instanceof BoxesError && error.code === "SPICE_AGENT_DISCONNECTED") {
        spiceStatus = undefined;
      } else if (error instanceof BoxesError && error.code === "SPICE_UNAVAILABLE") {
        spiceStatus = undefined;
      } else {
        throw error;
      }
    }
  }
  let qmp: CapabilityStatus = domain.domainType === "qemu" || domain.domainType === "kvm"
    ? { state: "configured" }
    : { state: "capability-missing", reason: "The active domain is not proven to be QEMU-backed" };
  if (options.probeQmp) {
    try {
      await probeQmp(nameOrUuid);
      qmp = { state: "connected" };
    } catch (error) {
      if (error instanceof BoxesError && (error.code === "QMP_UNAVAILABLE" || error.code === "QMP_COMMAND_UNSUPPORTED")) {
        qmp = { state: "capability-missing", reason: error.message };
      } else {
        throw error;
      }
    }
  }

  return {
    nameOrUuid,
    display,
    domain,
    backends: {
      qmp,
      spice: spiceStatus
        ? { state: spiceStatus.mainChannel === "connected" && spiceStatus.displayChannel === "connected" && spiceStatus.inputsChannel === "connected" ? "connected" : "connecting" }
        : spiceConfigured
        ? { state: "configured" }
        : { state: "unconfigured", reason: "A reviewed executable and SPICE display are required" },
      clipboard: spiceStatus
        ? spiceStatus.clipboard ? { state: "connected" } : { state: "agent-disconnected", reason: "The SPICE guest agent does not announce clipboard capability" }
        : spiceConfigured && domain.hasSpiceAgentChannel
        ? { state: "configured", reason: "Guest agent connection still requires SPICE status probing" }
        : { state: "capability-missing", reason: "SPICE helper and virtio SPICE agent channel are required" },
      fileTransfer: spiceStatus
        ? spiceStatus.fileTransfer ? { state: "connected" } : { state: "capability-missing", reason: "The SPICE guest agent does not announce file transfer" }
        : spiceConfigured && domain.hasSpiceAgentChannel
        ? { state: "configured", reason: "Guest agent connection still requires SPICE status probing" }
        : { state: "capability-missing", reason: "SPICE helper and virtio SPICE agent channel are required" }
    }
  };
}
