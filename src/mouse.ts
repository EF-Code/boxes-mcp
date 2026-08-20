import { BoxesError } from "./errors.js";
import { parseCoordinates, asRecord, boundedInteger, enumValue, requireNameOrUuid } from "./validation.js";
import { absoluteCoordinate, pixelCoordinate, probeQmp, sendQmpInput, type QmpButton, type QmpInputEvent } from "./qmp.js";
import { requireRunningDomain } from "./libvirt.js";
import { displayEndpoint } from "./display.js";
import { callSpiceHelper, spiceHelperConfigured, spiceHelperStatus } from "./spice.js";

export type MouseAction = "move" | "click" | "scroll";
export type MouseBackend = "auto" | "qmp" | "spice";
export type MouseButton = "left" | "middle" | "right";

export interface MouseRequest {
  nameOrUuid: string;
  action: MouseAction;
  x: number;
  y: number;
  coordinateSpace: "normalized" | "pixels";
  width?: number;
  height?: number;
  button?: MouseButton;
  deltaX?: number;
  deltaY?: number;
  backend: MouseBackend;
}

const buttons = ["left", "middle", "right"] as const;

function configuredBackend(): MouseBackend {
  const value = process.env.BOXES_INPUT_BACKEND?.trim();
  return value === "auto" || value === "qmp" || value === "spice" ? value : "auto";
}

export function parseMouseRequest(value: unknown): MouseRequest {
  const args = asRecord(value);
  const action = enumValue(args.action, "action", ["move", "click", "scroll"] as const);
  const coordinates = parseCoordinates(args);
  const request: MouseRequest = {
    nameOrUuid: requireNameOrUuid(args),
    action,
    ...coordinates,
    backend: enumValue(args.backend, "backend", ["auto", "qmp", "spice"] as const, "INVALID_ARGUMENT", configuredBackend())
  };

  if (action === "click") {
    request.button = enumValue(args.button, "button", buttons);
  }
  if (action === "scroll") {
    request.deltaX = boundedInteger(args.deltaX, "deltaX", -8, 8, 0);
    request.deltaY = boundedInteger(args.deltaY, "deltaY", -8, 8, 0);
    if (request.deltaX === 0 && request.deltaY === 0) {
      throw new BoxesError("INVALID_ARGUMENT", "scroll requires a non-zero deltaX or deltaY");
    }
  }
  return request;
}

function coordinateEvents(request: MouseRequest): QmpInputEvent[] {
  const x = request.coordinateSpace === "normalized"
    ? absoluteCoordinate(request.x)
    : pixelCoordinate(request.x, request.width || 1);
  const y = request.coordinateSpace === "normalized"
    ? absoluteCoordinate(request.y)
    : pixelCoordinate(request.y, request.height || 1);
  return [
    { type: "abs", data: { axis: "x", value: x } },
    { type: "abs", data: { axis: "y", value: y } }
  ];
}

function buttonEvent(button: QmpButton, down: boolean): QmpInputEvent {
  return { type: "btn", data: { button, down } };
}

function eventsForRequest(request: MouseRequest): QmpInputEvent[] {
  const events = coordinateEvents(request);
  if (request.action === "move") return events;
  if (request.action === "click") {
    return [...events, buttonEvent(request.button as MouseButton, true), buttonEvent(request.button as MouseButton, false)];
  }

  for (const [delta, positiveButton, negativeButton] of [
    [request.deltaY || 0, "wheel-down", "wheel-up"],
    [request.deltaX || 0, "wheel-right", "wheel-left"]
  ] as const) {
    const button = delta > 0 ? positiveButton : negativeButton;
    for (let index = 0; index < Math.abs(delta); index += 1) {
      events.push(buttonEvent(button, true), buttonEvent(button, false));
    }
  }
  return events;
}

export async function sendMouse(value: unknown): Promise<Record<string, unknown>> {
  const request = parseMouseRequest(value);
  await requireRunningDomain(request.nameOrUuid);

  let endpoint;
  try {
    endpoint = await displayEndpoint(request.nameOrUuid);
  } catch (error) {
    if (request.backend === "spice" || !(error instanceof BoxesError) || error.code !== "UNSUPPORTED_DISPLAY") throw error;
  }

  if (request.backend === "spice" || (request.backend === "auto" && endpoint?.protocol === "spice" && spiceHelperConfigured())) {
    let spiceReady = request.backend === "spice";
    if (!spiceReady && endpoint) {
      try {
        const status = await spiceHelperStatus(request.nameOrUuid, endpoint);
        spiceReady = status.mainChannel === "connected" && status.inputsChannel === "connected" && status.displayChannel === "connected";
      } catch {
        spiceReady = false;
      }
    }
    if (spiceReady && endpoint?.protocol === "spice" && spiceHelperConfigured()) {
      await callSpiceHelper({
        operation: "mouse",
        domain: request.nameOrUuid,
        display: endpoint,
        arguments: {
          action: request.action,
          x: request.x,
          y: request.y,
          coordinateSpace: request.coordinateSpace,
          width: request.width,
          height: request.height,
          button: request.button,
          deltaX: request.deltaX,
          deltaY: request.deltaY
        }
      });
      return {
        ok: true,
        backend: "spice",
        action: request.action,
        x: request.x,
        y: request.y,
        coordinateSpace: request.coordinateSpace,
        button: request.button,
        deltaX: request.deltaX,
        deltaY: request.deltaY
      };
    }
    if (request.backend === "spice") {
      if (endpoint?.protocol !== "spice") throw new BoxesError("UNSUPPORTED_DISPLAY", "SPICE mouse input requires a SPICE display");
      throw new BoxesError("SPICE_UNAVAILABLE", "SPICE inputs channel is not connected");
    }
  }

  // Auto remains QMP until the persistent helper can prove an active SPICE inputs channel.
  const qmpDevice = await probeQmp(request.nameOrUuid);
  await sendQmpInput(request.nameOrUuid, eventsForRequest(request));
  return {
    ok: true,
    backend: "qmp",
    action: request.action,
    x: request.x,
    y: request.y,
    coordinateSpace: request.coordinateSpace,
    display: endpoint?.display,
    head: 0,
    qmpDevice: qmpDevice.name || qmpDevice.index,
    button: request.button,
    deltaX: request.deltaX,
    deltaY: request.deltaY
  };
}

export function qmpEventsForTest(value: unknown): QmpInputEvent[] {
  return eventsForRequest(parseMouseRequest(value));
}
