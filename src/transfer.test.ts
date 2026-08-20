import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateTransferSource } from "./transfer.js";

describe("transfer path confinement", () => {
  let roots: string[] = [];

  afterEach(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true });
    roots = [];
    delete process.env.BOXES_TRANSFER_ROOT;
  });

  it("accepts a regular file below the configured root", async () => {
    const root = await mkdtemp(join("/tmp", "boxes-mcp-transfer-"));
    roots.push(root);
    const file = join(root, "report.txt");
    await writeFile(file, "report");
    process.env.BOXES_TRANSFER_ROOT = root;
    await expect(validateTransferSource(file)).resolves.toMatchObject({ basename: "report.txt", bytes: 6 });
  });

  it("rejects paths outside the configured root and symlink escapes", async () => {
    const root = await mkdtemp(join("/tmp", "boxes-mcp-transfer-"));
    const outside = await mkdtemp(join("/tmp", "boxes-mcp-outside-"));
    roots.push(root, outside);
    const file = join(outside, "secret.txt");
    await writeFile(file, "secret");
    await symlink(file, join(root, "link.txt"));
    process.env.BOXES_TRANSFER_ROOT = root;
    await expect(validateTransferSource(file)).rejects.toMatchObject({ code: "TRANSFER_PATH_DENIED" });
    await expect(validateTransferSource(join(root, "link.txt"))).rejects.toMatchObject({ code: "TRANSFER_PATH_DENIED" });
  });
});
