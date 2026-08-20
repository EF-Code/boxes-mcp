import { BoxesError } from "./errors.js";
import { displayEndpoint, type DisplayEndpoint } from "./display.js";
import { probeQmp } from "./qmp.js";
import { spiceHelperConfigured } from "./spice.js";
import { requireRunningDomain } from "./libvirt.js";

export interface BackendCapabilities {
  qmp: "available" | "unavailable" | "not-probed";
  spice: "available" | "unavailable";
  clipboard: "available" | "unavailable";
  fileTransfer: "available" | "unavailable";
}

export interface DomainCapabilities {
  nameOrUuid: string;
  display?: DisplayEndpoint;
  backends: BackendCapabilities;
}

/** Resolve backend capabilities without exposing monitor paths or credentials. */
export async function discoverCapabilities(
  nameOrUuid: string,
  options: { probeQmp?: boolean } = {}
): Promise<DomainCapabilities> {
  await requireRunningDomain(nameOrUuid);
  let display: DisplayEndpoint | undefined;
  try {
    display = await displayEndpoint(nameOrUuid);
  } catch (error) {
    if (!(error instanceof BoxesError) || error.code !== "UNSUPPORTED_DISPLAY") throw error;
  }

  const spiceAvailable = display?.protocol === "spice" && spiceHelperConfigured();
  let qmp: BackendCapabilities["qmp"] = "not-probed";
  if (options.probeQmp) {
    try {
      await probeQmp(nameOrUuid);
      qmp = "available";
    } catch (error) {
      if (error instanceof BoxesError && (error.code === "QMP_UNAVAILABLE" || error.code === "QMP_COMMAND_UNSUPPORTED")) {
        qmp = "unavailable";
      } else {
        throw error;
      }
    }
  }

  return {
    nameOrUuid,
    display,
    backends: {
      qmp,
      spice: spiceAvailable ? "available" : "unavailable",
      clipboard: spiceAvailable ? "available" : "unavailable",
      fileTransfer: spiceAvailable ? "available" : "unavailable"
    }
  };
}
