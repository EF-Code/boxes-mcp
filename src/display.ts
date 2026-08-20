import { BoxesError } from "./errors.js";
import { displayAddress } from "./libvirt.js";

export type DisplayProtocol = "spice" | "vnc" | "unknown";

export interface DisplayEndpoint {
  display: string;
  protocol: DisplayProtocol;
  host?: string;
  port?: number;
  path?: string;
}

export function parseDisplayEndpoint(display: string): DisplayEndpoint {
  const trimmed = display.trim();
  if (!trimmed) {
    throw new BoxesError("UNSUPPORTED_DISPLAY", "The domain has no active display endpoint");
  }

  try {
    const uri = new URL(trimmed);
    const protocol = uri.protocol.replace(":", "");
    const normalizedProtocol: DisplayProtocol = protocol === "spice" || protocol === "vnc"
      ? protocol
      : "unknown";
    const port = uri.port ? Number(uri.port) : undefined;
    return {
      display: trimmed,
      protocol: normalizedProtocol,
      host: uri.hostname || undefined,
      port,
      path: uri.pathname && uri.pathname !== "/" ? uri.pathname : undefined
    };
  } catch (error) {
    throw new BoxesError("UNSUPPORTED_DISPLAY", "The display endpoint is not a valid URI", { cause: error });
  }
}

export async function displayEndpoint(nameOrUuid: string): Promise<DisplayEndpoint> {
  const result = await displayAddress(nameOrUuid);
  return parseDisplayEndpoint(result.display);
}
