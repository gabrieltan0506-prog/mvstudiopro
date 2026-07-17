import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("loadDramaMixSnapshotBaseline", () => {
  const envBackup = { ...process.env };
  let tempRoot = "";

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "drama-mix-"));
    process.env = { ...envBackup, GROWTH_STORE_DIR: path.join(tempRoot, "growth") };
  });

  afterEach(async () => {
    process.env = envBackup;
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("reads nearest daily snapshot as baseline items", async () => {
    const dir = path.join(tempRoot, "growth", "drama-mix-snapshots");
    await fs.mkdir(dir, { recursive: true });
    const day = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await fs.writeFile(
      path.join(dir, `${day}.json`),
      JSON.stringify([
        { mixId: "m1", mixName: "漫剧甲", dramaKind: "ai_manhua", mixPlayCount: 1000 },
      ]),
      "utf8",
    );

    const mod = await import("./trendStore");
    const baseline = await mod.loadDramaMixSnapshotBaseline(7, 2);
    expect(baseline.items).toHaveLength(1);
    expect(baseline.items[0].dramaInfo?.mixId).toBe("m1");
    expect(baseline.items[0].dramaInfo?.mixPlayCount).toBe(1000);
  });
});
