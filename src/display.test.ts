import { describe, expect, it, vi } from "vitest";
import * as libvirt from "./libvirt.js";
import { displayEndpoint, parseDisplayEndpoint } from "./display.js";

vi.mock("./libvirt.js", () => ({
  displayAddress: vi.fn(),
  domainXml: vi.fn()
}));

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

  it("rejects credentials and unallowlisted endpoint query parameters", () => {
    expect(() => parseDisplayEndpoint("spice://user:secret@127.0.0.1:5900")).toThrow(/credentials/);
    expect(() => parseDisplayEndpoint("spice://127.0.0.1:5900?ticket=secret")).toThrow(/query/);
    expect(parseDisplayEndpoint("spice://127.0.0.1:5900?tls-port=5901")).toMatchObject({ tlsPort: 5901 });
  });

  it("uses the libvirt graphics-FD transport when SPICE has no listener", async () => {
    vi.mocked(libvirt.displayAddress).mockRejectedValue(new Error("No graphical display found"));
    vi.mocked(libvirt.domainXml).mockResolvedValue(`
      <domain><devices><graphics type='spice'><listen type='none'/></graphics></devices></domain>`);

    await expect(displayEndpoint("archlinux")).resolves.toEqual({
      display: "spice+libvirt-fd://local",
      protocol: "spice",
      transport: "libvirt-fd"
    });
  });
});
