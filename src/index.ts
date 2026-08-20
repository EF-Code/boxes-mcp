#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { handleTool, TOOL_DEFINITIONS } from "./tools.js";

export { handleTool, TOOL_DEFINITIONS } from "./tools.js";

const server = new Server(
  { name: "boxes-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));

const callTool = async (request: CallToolRequest): Promise<CallToolResult> => {
  return await handleTool(request.params.name, request.params.arguments) as unknown as CallToolResult;
};

server.setRequestHandler(CallToolRequestSchema, callTool);

const transport = new StdioServerTransport();
await server.connect(transport);
