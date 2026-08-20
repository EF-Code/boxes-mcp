import { describe, expect, it } from "vitest";
import { BoxesError } from "./errors.js";
import { parseClipboardRequest } from "./clipboard.js";

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
});
