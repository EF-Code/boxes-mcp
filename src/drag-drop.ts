import { BoxesError } from "./errors.js";
import { displayEndpoint } from "./display.js";
import { callSpiceHelper } from "./spice.js";
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
  const result = await callSpiceHelper("drag-drop", request.nameOrUuid, endpoint, {
    sourcePath: source.sourcePath,
    x: request.x,
    y: request.y,
    coordinateSpace: request.coordinateSpace,
    width: request.width,
    height: request.height,
    timeoutMs: request.timeoutMs
  });
  return {
    ok: true,
    backend: "spice",
    source: { basename: source.basename, bytes: source.bytes },
    result
  };
}
