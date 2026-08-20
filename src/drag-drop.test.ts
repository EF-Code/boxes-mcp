import { describe, expect, it } from "vitest";
import { initialDragState, parseDragDropRequest, reduceDragState } from "./drag-drop.js";

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

  it("keeps transfer, release, and application acceptance separate", () => {
    let state = initialDragState();
    state = reduceDragState(state, { type: "preflight-ready" });
    state = reduceDragState(state, { type: "transfer-started" });
    state = reduceDragState(state, { type: "transfer-completed", evidence: "helper completion" });
    state = reduceDragState(state, { type: "button-pressed" });
    state = reduceDragState(state, { type: "moved" });
    state = reduceDragState(state, { type: "released", evidence: "button cleanup" });
    expect(state).toMatchObject({ transferCompleted: true, mouseReleased: true, applicationAccepted: "unknown" });
    state = reduceDragState(state, { type: "application-accepted", accepted: "yes", evidence: "target evidence" });
    expect(state.phase).toBe("complete");
  });

  it("preserves an un-released state on failure for cleanup reporting", () => {
    let state = reduceDragState(initialDragState(), { type: "button-pressed" });
    state = reduceDragState(state, { type: "failed" });
    expect(state).toMatchObject({ phase: "failed", mouseReleased: false });
  });
});
