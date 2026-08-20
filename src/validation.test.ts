import { describe, expect, it } from "vitest";
import { BoxesError } from "./errors.js";
import { parseCoordinates, normalizedCoordinate, requireNameOrUuid } from "./validation.js";

describe("validation coordinates", () => {
  it("accepts normalized coordinates at boundaries", () => {
    expect(parseCoordinates({ x: 0, y: 1 })).toEqual({
      x: 0,
      y: 1,
      coordinateSpace: "normalized"
    });
  });

  it("requires dimensions for pixel coordinates", () => {
    expect(() => parseCoordinates({ x: 10, y: 10, coordinateSpace: "pixels" })).toThrow(BoxesError);
    expect(parseCoordinates({ x: 10, y: 20, coordinateSpace: "pixels", width: 100, height: 200 })).toEqual({
      x: 10,
      y: 20,
      coordinateSpace: "pixels",
      width: 100,
      height: 200
    });
  });

  it("rejects non-finite or out-of-range normalized values", () => {
    expect(() => parseCoordinates({ x: Number.NaN, y: 0.5 })).toThrow(BoxesError);
    expect(() => parseCoordinates({ x: 1.1, y: 0.5 })).toThrow(BoxesError);
  });

  it("normalizes values to the QMP range", () => {
    expect(normalizedCoordinate(0, 0x7fff)).toBe(0);
    expect(normalizedCoordinate(0.5, 0x7fff)).toBe(16384);
    expect(normalizedCoordinate(1, 0x7fff)).toBe(0x7fff);
  });

  it("rejects domain values that could become command-line options", () => {
    expect(() => requireNameOrUuid({ nameOrUuid: "--help" })).toThrow(BoxesError);
    expect(() => requireNameOrUuid({ nameOrUuid: "vm\nname" })).toThrow(BoxesError);
  });
});
