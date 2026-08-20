import { describe, expect, it } from "vitest";
import { BoxesError } from "./errors.js";
import { clipboardResultForTest, initialClipboardState, parseClipboardRequest, reduceClipboardState } from "./clipboard.js";

describe("clipboard contract", () => {
  it("accepts explicit UTF-8 read and write operations", () => {
    expect(parseClipboardRequest({ nameOrUuid: "vm", operation: "read" })).toMatchObject({
      nameOrUuid: "vm", operation: "read", selection: "clipboard"
    });
    expect(parseClipboardRequest({ nameOrUuid: "vm", operation: "write", text: "hello" })).toMatchObject({
      nameOrUuid: "vm", operation: "write", text: "hello"
    });
  });

  it("rejects oversized clipboard writes", () => {
    process.env.BOXES_MAX_CLIPBOARD_BYTES = "4";
    try {
      expect(() => parseClipboardRequest({ nameOrUuid: "vm", operation: "write", text: "hello" }))
        .toThrow(BoxesError);
    } finally {
      delete process.env.BOXES_MAX_CLIPBOARD_BYTES;
    }
  });

  it("models the guest-to-host grab/data/release sequence", () => {
    let state = initialClipboardState("read", 32);
    state = reduceClipboardState(state, { type: "agent-connected", clipboard: true });
    state = reduceClipboardState(state, { type: "guest-grab", hasUtf8: true });
    state = reduceClipboardState(state, { type: "data", text: "hello ", final: false });
    state = reduceClipboardState(state, { type: "data", text: "guest", final: true });
    expect(state).toMatchObject({ phase: "complete", text: "hello guest", bytes: 11 });
    expect(reduceClipboardState(state, { type: "data", text: "duplicate", final: true })).toEqual(state);
  });

  it("fails safely on missing capability, disconnect, invalid type, and byte limits", () => {
    expect(reduceClipboardState(initialClipboardState("read", 32), {
      type: "agent-connected", clipboard: false
    })).toMatchObject({ phase: "failed", errorCode: "SPICE_AGENT_DISCONNECTED" });
    let state = reduceClipboardState(initialClipboardState("read", 4), { type: "guest-grab", hasUtf8: true });
    state = reduceClipboardState(state, { type: "data", text: "hello", final: true });
    expect(state).toMatchObject({ phase: "failed", errorCode: "CLIPBOARD_TOO_LARGE" });
    expect(reduceClipboardState(initialClipboardState("write", 32), {
      type: "guest-request", hasUtf8: false
    })).toMatchObject({ phase: "failed", errorCode: "INVALID_ARGUMENT" });
    expect(reduceClipboardState(initialClipboardState("read", 32), { type: "disconnect" }))
      .toMatchObject({ phase: "failed", errorCode: "SPICE_AGENT_DISCONNECTED" });
  });

  it("models host-to-guest request and release", () => {
    let state = initialClipboardState("write", 32);
    state = reduceClipboardState(state, { type: "guest-request", hasUtf8: true });
    state = reduceClipboardState(state, { type: "release" });
    expect(state.phase).toBe("complete");
  });

  it("validates helper completion independently for both directions", () => {
    expect(clipboardResultForTest({ text: "hé", bytes: 3 }, "read", 8)).toEqual({ text: "hé", bytes: 3 });
    expect(clipboardResultForTest({ backend: "spice", completed: true }, "write", 8)).toEqual({
      backend: "spice", completed: true
    });
    expect(() => clipboardResultForTest({ backend: "spice", completed: false }, "write", 8)).toThrow(/confirm/);
    expect(() => clipboardResultForTest({ text: "hé", bytes: 2 }, "read", 8)).toThrow(/invalid/);
  });
});
