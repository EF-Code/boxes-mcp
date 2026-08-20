import {
  listDomains,
  domainInfo,
  startDomain,
  shutdownDomain,
  rebootDomain,
  suspendDomain,
  resumeDomain,
  undefineDomain,
  listSnapshots,
  createSnapshot,
  revertSnapshot,
  deleteSnapshot,
  displayAddress
} from "./libvirt.js";
import { captureScreenshot } from "./screenshot.js";
import { sendKeyboard } from "./keyboard.js";
import { sendMouse } from "./mouse.js";
import { clipboard as clipboardOperation } from "./clipboard.js";
import { dragDrop as dragDropOperation } from "./drag-drop.js";
import { discoverCapabilities } from "./capabilities.js";
import { BoxesError, errorCode, errorMessage } from "./errors.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

const domainProperty = { type: "string", description: "Domain name or UUID" };

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "boxes.list",
    description: "List all libvirt domains (VMs) managed by GNOME Boxes/libvirt",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "boxes.info",
    description: "Get detailed domain info",
    inputSchema: { type: "object", properties: { nameOrUuid: domainProperty }, required: ["nameOrUuid"] }
  },
  {
    name: "boxes.start",
    description: "Start a domain (VM)",
    inputSchema: { type: "object", properties: { nameOrUuid: domainProperty }, required: ["nameOrUuid"] }
  },
  {
    name: "boxes.shutdown",
    description: "Shutdown/Power off a domain (graceful by default)",
    inputSchema: {
      type: "object",
      properties: { nameOrUuid: domainProperty, force: { type: "boolean", description: "If true, force off (destroy)" } },
      required: ["nameOrUuid"]
    }
  },
  {
    name: "boxes.reboot",
    description: "Reboot a running domain",
    inputSchema: { type: "object", properties: { nameOrUuid: domainProperty }, required: ["nameOrUuid"] }
  },
  {
    name: "boxes.suspend",
    description: "Suspend a running domain",
    inputSchema: { type: "object", properties: { nameOrUuid: domainProperty }, required: ["nameOrUuid"] }
  },
  {
    name: "boxes.resume",
    description: "Resume a suspended domain",
    inputSchema: { type: "object", properties: { nameOrUuid: domainProperty }, required: ["nameOrUuid"] }
  },
  {
    name: "boxes.undefine",
    description: "Undefine a domain (remove from libvirt). Storage is NOT deleted.",
    inputSchema: {
      type: "object",
      properties: { nameOrUuid: domainProperty, keepStorage: { type: "boolean", description: "Keep storage (default: true)" } },
      required: ["nameOrUuid"]
    }
  },
  {
    name: "boxes.snapshots.list",
    description: "List snapshots for a domain",
    inputSchema: { type: "object", properties: { nameOrUuid: domainProperty }, required: ["nameOrUuid"] }
  },
  {
    name: "boxes.snapshots.create",
    description: "Create a snapshot for a domain",
    inputSchema: {
      type: "object",
      properties: {
        nameOrUuid: domainProperty,
        snapshot: { type: "string", description: "Snapshot name" },
        description: { type: "string", description: "Snapshot description" }
      },
      required: ["nameOrUuid", "snapshot"]
    }
  },
  {
    name: "boxes.snapshots.revert",
    description: "Revert a domain to a snapshot",
    inputSchema: {
      type: "object",
      properties: { nameOrUuid: domainProperty, snapshot: { type: "string", description: "Snapshot name" } },
      required: ["nameOrUuid", "snapshot"]
    }
  },
  {
    name: "boxes.snapshots.delete",
    description: "Delete a snapshot",
    inputSchema: {
      type: "object",
      properties: { nameOrUuid: domainProperty, snapshot: { type: "string", description: "Snapshot name" } },
      required: ["nameOrUuid", "snapshot"]
    }
  },
  {
    name: "boxes.display",
    description: "Get SPICE/VNC display address for VM (useful to open viewer)",
    inputSchema: { type: "object", properties: { nameOrUuid: domainProperty }, required: ["nameOrUuid"] }
  },
  {
    name: "boxes.capabilities",
    description: "Report observed display and interaction capability state for a running VM",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        nameOrUuid: domainProperty,
        probeQmp: { type: "boolean", default: false }
      },
      required: ["nameOrUuid"]
    }
  },
  {
    name: "boxes.screenshot",
    description: "Capture a running VM display screenshot as MCP image content",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        nameOrUuid: domainProperty,
        screen: { type: "integer", minimum: 0, maximum: 16, default: 0 },
        backend: { type: "string", enum: ["auto", "libvirt"], default: "auto" }
      },
      required: ["nameOrUuid"]
    }
  },
  {
    name: "boxes.keyboard",
    description: "Send a bounded allowlisted key sequence to a running VM",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        nameOrUuid: domainProperty,
        keys: { type: "array", minItems: 1, maxItems: 16, items: { type: "string" } },
        holdMs: { type: "integer", minimum: 0, maximum: 5000, default: 100 }
      },
      required: ["nameOrUuid", "keys"]
    }
  },
  {
    name: "boxes.mouse",
    description: "Send a typed mouse action through SPICE or QMP",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        nameOrUuid: domainProperty,
        action: { type: "string", enum: ["move", "click", "scroll"] },
        x: { type: "number", minimum: 0 },
        y: { type: "number", minimum: 0 },
        coordinateSpace: { type: "string", enum: ["normalized", "pixels"], default: "normalized" },
        width: { type: "integer", minimum: 1 },
        height: { type: "integer", minimum: 1 },
        button: { type: "string", enum: ["left", "middle", "right"] },
        deltaX: { type: "integer", minimum: -8, maximum: 8, default: 0 },
        deltaY: { type: "integer", minimum: -8, maximum: 8, default: 0 },
        backend: { type: "string", enum: ["auto", "qmp", "spice"], default: "auto" }
      },
      required: ["nameOrUuid", "action", "x", "y"],
      oneOf: [
        { properties: { action: { const: "move" } }, required: ["action"] },
        { properties: { action: { const: "click" }, button: { type: "string", enum: ["left", "middle", "right"] } }, required: ["action", "button"] },
        { properties: { action: { const: "scroll" } }, required: ["action"] }
      ]
    }
  },
  {
    name: "boxes.clipboard",
    description: "Read or write UTF-8 text through the SPICE guest agent clipboard",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        nameOrUuid: domainProperty,
        operation: { type: "string", enum: ["read", "write"] },
        selection: { type: "string", enum: ["clipboard"], default: "clipboard" },
        text: { type: "string" }
      },
      required: ["nameOrUuid", "operation"]
    }
  },
  {
    name: "boxes.drag_drop",
    description: "Experimental SPICE file transfer and mouse drag-and-drop operation",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        nameOrUuid: domainProperty,
        sourcePath: { type: "string", description: "File beneath BOXES_TRANSFER_ROOT" },
        x: { type: "number", minimum: 0 },
        y: { type: "number", minimum: 0 },
        coordinateSpace: { type: "string", enum: ["normalized", "pixels"], default: "normalized" },
        width: { type: "integer", minimum: 1 },
        height: { type: "integer", minimum: 1 },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 120000, default: 30000 }
      },
      required: ["nameOrUuid", "sourcePath", "x", "y"]
    }
  }
];

function textResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown): ToolResult {
  const code = errorCode(error);
  const message = errorMessage(error);
  return {
    content: [{ type: "text", text: error instanceof BoxesError ? `Error [${code}]: ${message}` : `Error: ${message}` }],
    isError: true
  };
}

export async function handleTool(name: string, args: unknown): Promise<ToolResult> {
  try {
    switch (name) {
      case "boxes.list": return textResult(await listDomains());
      case "boxes.info": return textResult(await domainInfo((args as { nameOrUuid: string }).nameOrUuid));
      case "boxes.start": return textResult(await startDomain((args as { nameOrUuid: string }).nameOrUuid));
      case "boxes.shutdown": {
        const request = args as { nameOrUuid: string; force?: boolean };
        return textResult(await shutdownDomain(request.nameOrUuid, request.force ?? false));
      }
      case "boxes.reboot": return textResult(await rebootDomain((args as { nameOrUuid: string }).nameOrUuid));
      case "boxes.suspend": return textResult(await suspendDomain((args as { nameOrUuid: string }).nameOrUuid));
      case "boxes.resume": return textResult(await resumeDomain((args as { nameOrUuid: string }).nameOrUuid));
      case "boxes.undefine": {
        const request = args as { nameOrUuid: string; keepStorage?: boolean };
        return textResult(await undefineDomain(request.nameOrUuid, request.keepStorage ?? true));
      }
      case "boxes.snapshots.list": return textResult(await listSnapshots((args as { nameOrUuid: string }).nameOrUuid));
      case "boxes.snapshots.create": {
        const request = args as { nameOrUuid: string; snapshot: string; description?: string };
        return textResult(await createSnapshot(request.nameOrUuid, request.snapshot, request.description));
      }
      case "boxes.snapshots.revert": {
        const request = args as { nameOrUuid: string; snapshot: string };
        return textResult(await revertSnapshot(request.nameOrUuid, request.snapshot));
      }
      case "boxes.snapshots.delete": {
        const request = args as { nameOrUuid: string; snapshot: string };
        return textResult(await deleteSnapshot(request.nameOrUuid, request.snapshot));
      }
      case "boxes.display": return textResult(await displayAddress((args as { nameOrUuid: string }).nameOrUuid));
      case "boxes.capabilities": {
        const request = args as { nameOrUuid: string; probeQmp?: boolean };
        return textResult(await discoverCapabilities(request.nameOrUuid, { probeQmp: request.probeQmp ?? false }));
      }
      case "boxes.screenshot": {
        const result = await captureScreenshot(args);
        return {
          content: [
            { type: "image", data: result.data, mimeType: result.mimeType },
            { type: "text", text: JSON.stringify({ ...result, data: undefined }, null, 2) }
          ]
        };
      }
      case "boxes.keyboard": return textResult(await sendKeyboard(args));
      case "boxes.mouse": return textResult(await sendMouse(args));
      case "boxes.clipboard": return textResult(await clipboardOperation(args));
      case "boxes.drag_drop": return textResult(await dragDropOperation(args));
      default: throw new BoxesError("INVALID_ARGUMENT", `Unknown tool: ${name}`);
    }
  } catch (error) {
    return errorResult(error);
  }
}
