#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { handleTool, TOOL_DEFINITIONS } from "./tools.js";
import { printSetupHelp, runDoctor, runSetup } from "./setup.js";

export { handleTool, TOOL_DEFINITIONS } from "./tools.js";
export * from "./setup.js";

async function runServer(): Promise<void> {
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
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "setup") {
    await runSetup(process.argv.slice(3));
    return;
  }
  if (command === "doctor") {
    runDoctor();
    return;
  }
  if (command === "--help" || command === "-h") {
    printSetupHelp();
    return;
  }
  await runServer();
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
