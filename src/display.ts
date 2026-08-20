import { BoxesError } from "./errors.js";
import { displayAddress } from "./libvirt.js";

export type DisplayProtocol = "spice" | "vnc" | "unknown";

export interface DisplayEndpoint {
  display: string;
  protocol: DisplayProtocol;
  host?: string;
  port?: number;
  tlsPort?: number;
  path?: string;
}

export interface DomainDisplayCapabilities {
  domainType?: "qemu" | "kvm" | "other";
  graphics?: DisplayProtocol;
  graphicsHost?: string;
  graphicsPort?: number;
  graphicsTlsPort?: number;
  graphicsSocket?: string;
  heads?: number;
  hasSpiceAgentChannel: boolean;
  hasAbsolutePointer: boolean;
}

function xmlAttribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*['\"]([^'\"]*)['\"]`, "i"));
  return match?.[1];
}

function integerAttribute(tag: string, name: string): number | undefined {
  const value = xmlAttribute(tag, name);
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

/** Parse only non-sensitive display facts from libvirt domain XML. */
export function parseDomainDisplayCapabilities(xml: string): DomainDisplayCapabilities {
  const domainTag = xml.match(/<domain\b[^>]*>/i)?.[0];
  const domainType = xmlAttribute(domainTag || "", "type");
  const graphicsTag = xml.match(/<graphics\b[^>]*>/i)?.[0];
  const graphicsType = xmlAttribute(graphicsTag || "", "type");
  const graphics = graphicsType === "spice" || graphicsType === "vnc" ? graphicsType : undefined;
  const listenTag = xml.match(/<listen\b[^>]*>/i)?.[0];
  const graphicsHost = xmlAttribute(listenTag || "", "address")
    || xmlAttribute(graphicsTag || "", "listen");
  const socket = xmlAttribute(graphicsTag || "", "socket");
  const inputTags = [...xml.matchAll(/<input\b[^>]*>/gi)].map(match => match[0]);
  const hasAbsolutePointer = inputTags.some(tag =>
    xmlAttribute(tag, "type") === "tablet" || xmlAttribute(tag, "type") === "absolute"
  );
  const videoTag = xml.match(/<video\b[^>]*>/i)?.[0];
  const heads = integerAttribute(videoTag || "", "heads");
  const agentChannel = /<channel\b[^>]*type=['\"]spicevmc['\"][^>]*>/i.test(xml)
    && /<target\b[^>]*name=['\"]com\.redhat\.spice\.0['\"][^>]*>/i.test(xml);

  return {
    domainType: domainType === "qemu" || domainType === "kvm" ? domainType : domainType ? "other" : undefined,
    graphics,
    graphicsHost,
    graphicsPort: integerAttribute(graphicsTag || "", "port"),
    graphicsTlsPort: integerAttribute(graphicsTag || "", "tlsPort"),
    graphicsSocket: socket,
    heads,
    hasSpiceAgentChannel: agentChannel,
    hasAbsolutePointer
  };
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
    const tlsPortValue = uri.searchParams.get("tls-port");
    const tlsPort = tlsPortValue && /^\d+$/.test(tlsPortValue) ? Number(tlsPortValue) : undefined;
    const normalizedPath = uri.pathname && uri.pathname !== "/" ? uri.pathname : undefined;
    return {
      display: trimmed,
      protocol: normalizedProtocol,
      host: uri.hostname || undefined,
      port,
      tlsPort,
      path: normalizedPath
    };
  } catch (error) {
    throw new BoxesError("UNSUPPORTED_DISPLAY", "The display endpoint is not a valid URI", { cause: error });
  }
}

export async function displayEndpoint(nameOrUuid: string): Promise<DisplayEndpoint> {
  const result = await displayAddress(nameOrUuid);
  return parseDisplayEndpoint(result.display);
}
