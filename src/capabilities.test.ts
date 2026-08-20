import { beforeEach, describe, expect, it, vi } from "vitest";
import * as libvirt from "./libvirt.js";
import * as qmp from "./qmp.js";
import * as spice from "./spice.js";
import { discoverCapabilities } from "./capabilities.js";

vi.mock("./libvirt.js", () => ({
  requireRunningDomain: vi.fn(),
  displayAddress: vi.fn()
}));
vi.mock("./qmp.js", () => ({ probeQmp: vi.fn() }));
vi.mock("./spice.js", () => ({ spiceHelperConfigured: vi.fn() }));

describe("capability discovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(libvirt.requireRunningDomain).mockResolvedValue({ State: "running" });
    vi.mocked(libvirt.displayAddress).mockResolvedValue({ display: "spice://127.0.0.1:5900" });
    vi.mocked(spice.spiceHelperConfigured).mockReturnValue(true);
  });

  it("reports structured display and helper-backed capabilities", async () => {
    vi.mocked(qmp.probeQmp).mockResolvedValue();
    await expect(discoverCapabilities("vm", { probeQmp: true })).resolves.toMatchObject({
      display: { protocol: "spice", host: "127.0.0.1", port: 5900 },
      backends: { qmp: "available", spice: "available", clipboard: "available", fileTransfer: "available" }
    });
  });

  it("does not probe QMP unless requested", async () => {
    vi.mocked(spice.spiceHelperConfigured).mockReturnValue(false);
    await expect(discoverCapabilities("vm")).resolves.toMatchObject({
      backends: { qmp: "not-probed", spice: "unavailable" }
    });
    expect(qmp.probeQmp).not.toHaveBeenCalled();
  });
});
