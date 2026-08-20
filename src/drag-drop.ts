import { BoxesError } from "./errors.js";
import { displayEndpoint } from "./display.js";
import { callSpiceHelper, spiceHelperStatus } from "./spice.js";
import { parseCoordinates, asRecord, boundedInteger, requireNameOrUuid } from "./validation.js";
import { validateTransferSource, type TransferSource } from "./transfer.js";
import { requireRunningDomain } from "./libvirt.js";

export interface DragDropRequest {
  nameOrUuid: string;
  sourcePath: unknown;
  x: number;
  y: number;
  coordinateSpace: "normalized" | "pixels";
  width?: number;
  height?: number;
  timeoutMs: number;
}

export type DragPhase = "preflight" | "transferring" | "pressed" | "moving" | "released" | "complete" | "failed" | "cancelled";

export interface DragState {
  phase: DragPhase;
  transferCompleted: boolean;
  mouseReleased: boolean;
  applicationAccepted: "yes" | "no" | "unknown";
  evidence: string[];
}

export type DragEvent =
  | { type: "preflight-ready" }
  | { type: "transfer-started" }
  | { type: "transfer-completed"; evidence?: string }
  | { type: "button-pressed" }
  | { type: "moved" }
  | { type: "released"; evidence?: string }
  | { type: "application-accepted"; accepted: "yes" | "no"; evidence: string }
  | { type: "cancelled" }
  | { type: "failed" };

export function initialDragState(): DragState {
  return { phase: "preflight", transferCompleted: false, mouseReleased: false, applicationAccepted: "unknown", evidence: [] };
}

/** Pure coordinator for transfer, pointer cleanup, and application evidence. */
export function reduceDragState(state: DragState, event: DragEvent): DragState {
  if (state.phase === "complete" || state.phase === "failed" || state.phase === "cancelled") return state;
  if (event.type === "failed") return { ...state, phase: "failed" };
  if (event.type === "cancelled") return { ...state, phase: "cancelled" };
  if (event.type === "preflight-ready") return { ...state, phase: "preflight" };
  if (event.type === "transfer-started") return { ...state, phase: "transferring" };
  if (event.type === "transfer-completed") return {
    ...state,
    phase: "transferring",
    transferCompleted: true,
    evidence: event.evidence ? [...state.evidence, event.evidence] : state.evidence
  };
  if (event.type === "button-pressed") return { ...state, phase: "pressed" };
  if (event.type === "moved") return { ...state, phase: "moving" };
  if (event.type === "released") return {
    ...state,
    phase: "released",
    mouseReleased: true,
    evidence: event.evidence ? [...state.evidence, event.evidence] : state.evidence
  };
  if (event.type === "application-accepted") return {
    ...state,
    applicationAccepted: event.accepted,
    evidence: [...state.evidence, event.evidence],
    phase: state.mouseReleased && state.transferCompleted ? "complete" : state.phase
  };
  return state;
}

function validateDragResult(value: unknown): {
  transferCompleted: boolean;
  mouseReleased: boolean;
  applicationAccepted: "yes" | "no" | "unknown";
  evidence: string[];
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BoxesError("BACKEND_UNAVAILABLE", "SPICE helper returned an invalid drag result");
  }
  const result = value as Record<string, unknown>;
  if (typeof result.transferCompleted !== "boolean" || typeof result.mouseReleased !== "boolean"
    || !["yes", "no", "unknown"].includes(result.applicationAccepted as string)
    || !Array.isArray(result.evidence) || result.evidence.some(item => typeof item !== "string")) {
    throw new BoxesError("BACKEND_UNAVAILABLE", "SPICE helper did not return complete drag evidence");
  }
  return {
    transferCompleted: result.transferCompleted,
    mouseReleased: result.mouseReleased,
    applicationAccepted: result.applicationAccepted as "yes" | "no" | "unknown",
    evidence: result.evidence as string[]
  };
}

export function parseDragDropRequest(value: unknown): DragDropRequest {
  const args = asRecord(value);
  const coordinates = parseCoordinates(args);
  return {
    nameOrUuid: requireNameOrUuid(args),
    sourcePath: args.sourcePath,
    ...coordinates,
    timeoutMs: boundedInteger(args.timeoutMs, "timeoutMs", 1_000, 120_000, 30_000)
  };
}

export async function dragDrop(value: unknown): Promise<unknown> {
  const request = parseDragDropRequest(value);
  await requireRunningDomain(request.nameOrUuid);
  const source: TransferSource = await validateTransferSource(request.sourcePath);
  const endpoint = await displayEndpoint(request.nameOrUuid);
  if (endpoint.protocol !== "spice") throw new BoxesError("UNSUPPORTED_DISPLAY", "Drag-and-drop requires a SPICE display");
  const status = await spiceHelperStatus(request.nameOrUuid, endpoint);
  if (status.mainChannel !== "connected" || status.inputsChannel !== "connected" || status.displayChannel !== "connected") {
    throw new BoxesError("SPICE_CAPABILITY_MISSING", "SPICE main, display, and inputs channels must be connected");
  }
  if (!status.fileTransfer) throw new BoxesError("SPICE_CAPABILITY_MISSING", "SPICE file transfer is not available");
  const result = await callSpiceHelper({
    operation: "drag-drop",
    domain: request.nameOrUuid,
    display: endpoint,
    arguments: {
      sourcePath: source.sourcePath,
      x: request.x,
      y: request.y,
      coordinateSpace: request.coordinateSpace,
      width: request.width,
      height: request.height,
      maxBytes: source.bytes,
      timeoutMs: request.timeoutMs
    }
  });
  return {
    ok: true,
    backend: "spice",
    source: { basename: source.basename, bytes: source.bytes },
    result: validateDragResult(result)
  };
}
