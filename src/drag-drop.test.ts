import { describe, expect, it } from "vitest";
import { parseDragDropRequest } from "./drag-drop.js";

describe("drag/drop contract", () => {
  it("keeps the operation bounded and coordinate-typed", () => {
    expect(parseDragDropRequest({
      nameOrUuid: "vm",
      sourcePath: "report.txt",
      x: 0.5,
      y: 0.25,
      timeoutMs: 10_000
    })).toMatchObject({
      nameOrUuid: "vm",
      sourcePath: "report.txt",
      coordinateSpace: "normalized",
      timeoutMs: 10_000
    });
  });

  it("rejects an unbounded timeout", () => {
    expect(() => parseDragDropRequest({
      nameOrUuid: "vm", sourcePath: "report.txt", x: 0, y: 0, timeoutMs: 120_001
    })).toThrow();
  });
});
