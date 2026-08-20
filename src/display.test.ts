import { describe, expect, it } from "vitest";
import { parseDisplayEndpoint } from "./display.js";

describe("display endpoint parsing", () => {
  it("parses SPICE and VNC endpoints without exposing credentials", () => {
    expect(parseDisplayEndpoint("spice://127.0.0.1:5900")).toEqual({
      display: "spice://127.0.0.1:5900",
      protocol: "spice",
      host: "127.0.0.1",
      port: 5900
    });
    expect(parseDisplayEndpoint("vnc://127.0.0.1:5901").protocol).toBe("vnc");
  });
});
