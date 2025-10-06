#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
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

const server = new Server(
  {
    name: "boxes-mcp",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "boxes.list",
        description: "List all libvirt domains (VMs) managed by GNOME Boxes/libvirt",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "boxes.info",
        description: "Get detailed domain info",
        inputSchema: {
          type: "object",
          properties: {
            nameOrUuid: { type: "string", description: "Domain name or UUID" }
          },
          required: ["nameOrUuid"]
        }
      },
      {
        name: "boxes.start",
        description: "Start a domain (VM)",
        inputSchema: {
          type: "object",
          properties: {
            nameOrUuid: { type: "string", description: "Domain name or UUID" }
          },
          required: ["nameOrUuid"]
        }
      },
      {
        name: "boxes.shutdown",
        description: "Shutdown/Power off a domain (graceful by default)",
        inputSchema: {
          type: "object",
          properties: {
            nameOrUuid: { type: "string", description: "Domain name or UUID" },
            force: { type: "boolean", description: "If true, force off (destroy)" }
          },
          required: ["nameOrUuid"]
        }
      },
      {
        name: "boxes.reboot",
        description: "Reboot a running domain",
        inputSchema: {
          type: "object",
          properties: {
            nameOrUuid: { type: "string", description: "Domain name or UUID" }
          },
          required: ["nameOrUuid"]
        }
      },
      {
        name: "boxes.suspend",
        description: "Suspend a running domain",
        inputSchema: {
          type: "object",
          properties: {
            nameOrUuid: { type: "string", description: "Domain name or UUID" }
          },
          required: ["nameOrUuid"]
        }
      },
      {
        name: "boxes.resume",
        description: "Resume a suspended domain",
        inputSchema: {
          type: "object",
          properties: {
            nameOrUuid: { type: "string", description: "Domain name or UUID" }
          },
          required: ["nameOrUuid"]
        }
      },
      {
        name: "boxes.undefine",
        description: "Undefine a domain (remove from libvirt). Storage is NOT deleted.",
        inputSchema: {
          type: "object",
          properties: {
            nameOrUuid: { type: "string", description: "Domain name or UUID" },
            keepStorage: { type: "boolean", description: "Keep storage (default: true)" }
          },
          required: ["nameOrUuid"]
        }
      },
      {
        name: "boxes.snapshots.list",
        description: "List snapshots for a domain",
        inputSchema: {
          type: "object",
          properties: {
            nameOrUuid: { type: "string", description: "Domain name or UUID" }
          },
          required: ["nameOrUuid"]
        }
      },
      {
        name: "boxes.snapshots.create",
        description: "Create a snapshot for a domain",
        inputSchema: {
          type: "object",
          properties: {
            nameOrUuid: { type: "string", description: "Domain name or UUID" },
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
          properties: {
            nameOrUuid: { type: "string", description: "Domain name or UUID" },
            snapshot: { type: "string", description: "Snapshot name" }
          },
          required: ["nameOrUuid", "snapshot"]
        }
      },
      {
        name: "boxes.snapshots.delete",
        description: "Delete a snapshot",
        inputSchema: {
          type: "object",
          properties: {
            nameOrUuid: { type: "string", description: "Domain name or UUID" },
            snapshot: { type: "string", description: "Snapshot name" }
          },
          required: ["nameOrUuid", "snapshot"]
        }
      },
      {
        name: "boxes.display",
        description: "Get SPICE/VNC display address for VM (useful to open viewer)",
        inputSchema: {
          type: "object",
          properties: {
            nameOrUuid: { type: "string", description: "Domain name or UUID" }
          },
          required: ["nameOrUuid"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "boxes.list": {
        const vms = await listDomains();
        return {
          content: [{ type: "text", text: JSON.stringify(vms, null, 2) }]
        };
      }

      case "boxes.info": {
        const { nameOrUuid } = args as { nameOrUuid: string };
        const info = await domainInfo(nameOrUuid);
        return {
          content: [{ type: "text", text: JSON.stringify(info, null, 2) }]
        };
      }

      case "boxes.start": {
        const { nameOrUuid } = args as { nameOrUuid: string };
        const result = await startDomain(nameOrUuid);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }

      case "boxes.shutdown": {
        const { nameOrUuid, force } = args as { nameOrUuid: string; force?: boolean };
        const result = await shutdownDomain(nameOrUuid, force ?? false);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }

      case "boxes.reboot": {
        const { nameOrUuid } = args as { nameOrUuid: string };
        const result = await rebootDomain(nameOrUuid);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }

      case "boxes.suspend": {
        const { nameOrUuid } = args as { nameOrUuid: string };
        const result = await suspendDomain(nameOrUuid);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }

      case "boxes.resume": {
        const { nameOrUuid } = args as { nameOrUuid: string };
        const result = await resumeDomain(nameOrUuid);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }

      case "boxes.undefine": {
        const { nameOrUuid, keepStorage } = args as { nameOrUuid: string; keepStorage?: boolean };
        const result = await undefineDomain(nameOrUuid, keepStorage ?? true);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }

      case "boxes.snapshots.list": {
        const { nameOrUuid } = args as { nameOrUuid: string };
        const snaps = await listSnapshots(nameOrUuid);
        return {
          content: [{ type: "text", text: JSON.stringify(snaps, null, 2) }]
        };
      }

      case "boxes.snapshots.create": {
        const { nameOrUuid, snapshot, description } = args as {
          nameOrUuid: string;
          snapshot: string;
          description?: string
        };
        const result = await createSnapshot(nameOrUuid, snapshot, description);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }

      case "boxes.snapshots.revert": {
        const { nameOrUuid, snapshot } = args as { nameOrUuid: string; snapshot: string };
        const result = await revertSnapshot(nameOrUuid, snapshot);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }

      case "boxes.snapshots.delete": {
        const { nameOrUuid, snapshot } = args as { nameOrUuid: string; snapshot: string };
        const result = await deleteSnapshot(nameOrUuid, snapshot);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }

      case "boxes.display": {
        const { nameOrUuid } = args as { nameOrUuid: string };
        const result = await displayAddress(nameOrUuid);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true
    };
  }
});

// Start transport
const transport = new StdioServerTransport();
await server.connect(transport);
