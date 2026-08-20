import { describe, expect, it } from "vitest";
import { handleTool, TOOL_DEFINITIONS } from "./tools.js";

describe("MCP tool registry", () => {
  it("contains all existing tools and new interaction tools", () => {
    const names = TOOL_DEFINITIONS.map(tool => tool.name);
    expect(names).toHaveLength(18);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining([
      "boxes.list",
      "boxes.info",
      "boxes.start",
      "boxes.shutdown",
      "boxes.reboot",
      "boxes.suspend",
      "boxes.resume",
      "boxes.undefine",
      "boxes.snapshots.list",
      "boxes.snapshots.create",
      "boxes.snapshots.revert",
      "boxes.snapshots.delete",
      "boxes.display",
      "boxes.screenshot",
      "boxes.keyboard",
      "boxes.mouse",
      "boxes.clipboard",
      "boxes.drag_drop"
    ]));
  });

  it("uses the boxes namespace and snapshot namespace consistently", () => {
    for (const tool of TOOL_DEFINITIONS) expect(tool.name).toMatch(/^boxes\./);
    for (const tool of TOOL_DEFINITIONS.filter(tool => tool.name.includes("snapshots"))) {
      expect(tool.name).toMatch(/^boxes\.snapshots\./);
    }
  });

  it("declares required fields for interaction tools", () => {
    const byName = new Map(TOOL_DEFINITIONS.map(tool => [tool.name, tool]));
    expect(byName.get("boxes.screenshot")?.inputSchema).toMatchObject({ required: ["nameOrUuid"] });
    expect(byName.get("boxes.keyboard")?.inputSchema).toMatchObject({ required: ["nameOrUuid", "keys"] });
    expect(byName.get("boxes.mouse")?.inputSchema).toMatchObject({
      required: ["nameOrUuid", "action", "x", "y"]
    });
    expect(byName.get("boxes.clipboard")?.inputSchema).toMatchObject({
      required: ["nameOrUuid", "operation"]
    });
    expect(byName.get("boxes.drag_drop")?.inputSchema).toMatchObject({
      required: ["nameOrUuid", "sourcePath", "x", "y"]
    });
  });
});

describe("MCP handler boundary", () => {
  it("returns a stable error for unknown tools", async () => {
    const result = await handleTool("boxes.unknown", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text).toContain("INVALID_ARGUMENT");
  });
});
