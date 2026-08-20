import { beforeEach, describe, expect, it, vi } from "vitest";
import * as libvirt from "./libvirt.js";
import * as qmp from "./qmp.js";
import * as spice from "./spice.js";
import { discoverCapabilities } from "./capabilities.js";

vi.mock("./libvirt.js", () => ({
  requireRunningDomain: vi.fn(),
  displayAddress: vi.fn(),
  domainXml: vi.fn()
}));
vi.mock("./qmp.js", () => ({ probeQmp: vi.fn() }));
vi.mock("./spice.js", () => ({ spiceHelperConfigured: vi.fn() }));

describe("capability discovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(libvirt.requireRunningDomain).mockResolvedValue({ State: "running" });
    vi.mocked(libvirt.displayAddress).mockResolvedValue({ display: "spice://127.0.0.1:5900" });
    vi.mocked(libvirt.domainXml).mockResolvedValue(`
      <domain type='kvm'><devices>
        <graphics type='spice' port='5900'/>
        <channel type='spicevmc'><target type='virtio' name='com.redhat.spice.0'/></channel>
        <input type='tablet' bus='usb'/>
      </devices></domain>`);
    vi.mocked(spice.spiceHelperConfigured).mockReturnValue(true);
  });

  it("reports structured display and helper-backed capabilities", async () => {
    vi.mocked(qmp.probeQmp).mockResolvedValue({ absolute: true });
    await expect(discoverCapabilities("vm", { probeQmp: true })).resolves.toMatchObject({
      display: { protocol: "spice", host: "127.0.0.1", port: 5900 },
      domain: { domainType: "kvm", hasSpiceAgentChannel: true, hasAbsolutePointer: true },
      backends: {
        qmp: { state: "connected" },
        spice: { state: "configured" },
        clipboard: { state: "configured" },
        fileTransfer: { state: "configured" }
      }
    });
  });

  it("does not probe QMP unless requested", async () => {
    vi.mocked(spice.spiceHelperConfigured).mockReturnValue(false);
    await expect(discoverCapabilities("vm")).resolves.toMatchObject({
      backends: {
        qmp: { state: "configured" },
        spice: { state: "unconfigured" }
      }
    });
    expect(qmp.probeQmp).not.toHaveBeenCalled();
  });
});
