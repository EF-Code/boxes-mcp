import { describe, expect, it } from "vitest";
import { captureScreenshot } from "./screenshot.js";
import { sendKeyboard } from "./keyboard.js";
import { sendMouse } from "./mouse.js";
import { clipboard } from "./clipboard.js";
import { dragDrop } from "./drag-drop.js";
import { transferFile } from "./transfer.js";
import { discoverCapabilities } from "./capabilities.js";

const integrationRequested = process.env.BOXES_INTEGRATION === "1"
  || process.env.BOXES_TEST_VM !== undefined
  || process.env.BOXES_TEST_VM_DISPOSABLE !== undefined;
const integrationEnabled = process.env.BOXES_INTEGRATION === "1"
  && typeof process.env.BOXES_TEST_VM === "string"
  && process.env.BOXES_TEST_VM.trim().length > 0
  && process.env.BOXES_TEST_VM_DISPOSABLE === "1";

function requireIntegrationConfiguration(): string {
  if (!integrationEnabled) {
    throw new Error("Live integration requires BOXES_INTEGRATION=1, BOXES_TEST_VM=<explicit-domain>, and BOXES_TEST_VM_DISPOSABLE=1");
  }
  return process.env.BOXES_TEST_VM as string;
}

function optionalTarget(): { x: number; y: number; coordinateSpace: "normalized" | "pixels"; width?: number; height?: number } | undefined {
  const x = process.env.BOXES_TEST_X === undefined ? 0.5 : Number(process.env.BOXES_TEST_X);
  const y = process.env.BOXES_TEST_Y === undefined ? 0.5 : Number(process.env.BOXES_TEST_Y);
  const coordinateSpace = process.env.BOXES_TEST_COORDINATE_SPACE === "pixels" ? "pixels" : "normalized";
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  if (coordinateSpace === "pixels") {
    const width = Number(process.env.BOXES_TEST_WIDTH);
    const height = Number(process.env.BOXES_TEST_HEIGHT);
    if (!Number.isInteger(width) || !Number.isInteger(height)) return undefined;
    return { x, y, coordinateSpace, width, height };
  }
  return { x, y, coordinateSpace };
}

const suite = integrationRequested ? describe : describe.skip;

suite("opt-in disposable VM integration", () => {
  it("requires the complete safety gate", () => {
    expect(() => requireIntegrationConfiguration()).not.toThrow();
  });

  it("captures a screenshot through libvirt", async () => {
    const vm = requireIntegrationConfiguration();
    const result = await captureScreenshot({ nameOrUuid: vm, screen: 0, backend: "libvirt" });
    expect(result).toMatchObject({ backend: "libvirt", screen: 0 });
    expect(result.data.length).toBeGreaterThan(0);
  });

  it("sends a harmless keyboard escape", async () => {
    const vm = requireIntegrationConfiguration();
    await expect(sendKeyboard({ nameOrUuid: vm, keys: ["ESC"] })).resolves.toMatchObject({ backend: "virsh" });
  });

  it("probes and exercises QMP only when an absolute pointer is observed", async ({ skip }) => {
    const vm = requireIntegrationConfiguration();
    const capabilities = await discoverCapabilities(vm, { probeQmp: true });
    if (capabilities.backends.qmp.state !== "connected") skip(`QMP not available: ${capabilities.backends.qmp.reason || "unknown"}`);
    await expect(sendMouse({ nameOrUuid: vm, action: "move", x: 0.5, y: 0.5, backend: "qmp" }))
      .resolves.toMatchObject({ backend: "qmp", head: 0 });
  });

  it("exercises SPICE mouse only when all required channels are connected", async ({ skip }) => {
    const vm = requireIntegrationConfiguration();
    const capabilities = await discoverCapabilities(vm, { probeSpice: true });
    if (capabilities.backends.spice.state !== "connected") skip(`SPICE not connected: ${capabilities.backends.spice.reason || "unknown"}`);
    await expect(sendMouse({ nameOrUuid: vm, action: "move", x: 0.5, y: 0.5, backend: "spice" }))
      .resolves.toMatchObject({ backend: "spice" });
  });

  it("round-trips clipboard text only when guest-agent clipboard is observed", async ({ skip }) => {
    const vm = requireIntegrationConfiguration();
    const capabilities = await discoverCapabilities(vm, { probeSpice: true });
    if (capabilities.backends.clipboard.state !== "connected") skip(`Clipboard not connected: ${capabilities.backends.clipboard.reason || "unknown"}`);
    await expect(clipboard({ nameOrUuid: vm, operation: "write", selection: "clipboard", text: "boxes-mcp integration" }))
      .resolves.toMatchObject({ result: { backend: "spice", completed: true } });
    await expect(clipboard({ nameOrUuid: vm, operation: "read", selection: "clipboard" }))
      .resolves.toMatchObject({ result: { text: "boxes-mcp integration" } });
  });

  it("transfers a caller-selected confined file only when file transfer is observed", async ({ skip }) => {
    const vm = requireIntegrationConfiguration();
    const sourcePath = process.env.BOXES_TEST_SOURCE_PATH;
    if (!sourcePath || !process.env.BOXES_TRANSFER_ROOT) skip("Set BOXES_TRANSFER_ROOT and BOXES_TEST_SOURCE_PATH for transfer evidence");
    const capabilities = await discoverCapabilities(vm, { probeSpice: true });
    if (capabilities.backends.fileTransfer.state !== "connected") skip(`File transfer not connected: ${capabilities.backends.fileTransfer.reason || "unknown"}`);
    await expect(transferFile({ nameOrUuid: vm, sourcePath, timeoutMs: 30_000 }))
      .resolves.toMatchObject({ backend: "spice", transportCompleted: true });
  });

  it("reports experimental drag evidence without claiming application acceptance", async ({ skip }) => {
    const vm = requireIntegrationConfiguration();
    const sourcePath = process.env.BOXES_TEST_SOURCE_PATH;
    const target = optionalTarget();
    if (!sourcePath || !process.env.BOXES_TRANSFER_ROOT || !target) skip("Set transfer-root, source, and valid target variables for drag evidence");
    const capabilities = await discoverCapabilities(vm, { probeSpice: true });
    if (capabilities.backends.fileTransfer.state !== "connected" || capabilities.backends.spice.state !== "connected") {
      skip("SPICE channels and file transfer are not all connected");
    }
    const result = await dragDrop({ nameOrUuid: vm, sourcePath, ...target, timeoutMs: 30_000 });
    expect(result).toMatchObject({ backend: "spice", result: { transferCompleted: true, mouseReleased: true, applicationAccepted: "unknown" } });
  });

  it("returns the expected error when a disposable guest agent is manually disconnected", async ({ skip }) => {
    const vm = requireIntegrationConfiguration();
    if (process.env.BOXES_TEST_AGENT_DISCONNECTED !== "1") {
      skip("Set BOXES_TEST_AGENT_DISCONNECTED=1 only after manually disconnecting spice-vdagent in the disposable guest");
    }
    await expect(clipboard({ nameOrUuid: vm, operation: "read", selection: "clipboard" }))
      .rejects.toMatchObject({ code: "SPICE_AGENT_DISCONNECTED" });
  });
});
