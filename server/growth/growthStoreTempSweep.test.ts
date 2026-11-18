import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isGrowthStoreTempFileName, sweepGrowthStoreStaleTempFiles } from "./growthStoreTempSweep";

const ORIGINAL_STORE_DIR = process.env.GROWTH_STORE_DIR;
const HOUR = 60 * 60 * 1000;
const UUID = "123e4567-e89b-42d3-a456-426614174000";

async function put(file: string, body = "x", ageMs = 2 * HOUR) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
  const t = new Date(Date.now() - ageMs);
  await fs.utimes(file, t, t);
}
const exists = (file: string) => fs.lstat(file).then(() => true, () => false);

describe("growth store 临时文件", () => {
  let root = "";

  beforeEach(async () => {
    vi.resetModules();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-temp-sweep-"));
    process.env.GROWTH_STORE_DIR = root;
    process.env.GROWTH_DISABLE_STORE_LAYOUT_MIGRATE = "1";
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (ORIGINAL_STORE_DIR) process.env.GROWTH_STORE_DIR = ORIGINAL_STORE_DIR;
    else delete process.env.GROWTH_STORE_DIR;
    delete process.env.GROWTH_DISABLE_STORE_LAYOUT_MIGRATE;
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it.each(["writeFile", "rename"] as const)("writeJsonAtomic %s 失败（ENOSPC）不留临时文件、原文件不变并抛出原错误", async (step) => {
    const target = path.join(root, "runtime-control.json");
    const original = JSON.stringify({ updatedAt: "old", value: { mode: "auto", burst: "auto", burstPlatforms: [] } });
    await fs.writeFile(target, original);
    const { writeGrowthRuntimeControl } = await import("./trendStore");
    const enospc = Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    const realWriteFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (file: any, data: any, opts?: any) => {
      await realWriteFile(file, data, opts);
      if (step === "writeFile" && String(file).startsWith(`${target}.`)) {
        await realWriteFile(file, "partial");
        throw enospc;
      }
    });
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (from: any, to: any) => {
      if (step === "rename" && String(to) === target) throw enospc;
      return realRename(from, to);
    });
    await expect(writeGrowthRuntimeControl("live")).rejects.toBe(enospc);
    expect((await fs.readdir(root)).filter((name) => name.startsWith("runtime-control.json."))).toEqual([]);
    expect(await fs.readFile(target, "utf8")).toBe(original);
  });

  it("命名规则只命中各写者临时名", () => {
    for (const name of [
      "current.json.123.1763450000000.k3j2h1.next",
      "douyin.current.json.gz.9.1763450000000.abc.next",
      "adaptive-config.json.42.7.next",
      ".growth-platform-collection-state.json.42.1763450000000.next",
      `douyin.json.42.${UUID}.next`,
      "weixin-channels-miner.json.42.1763450000000.tmp",
    ]) expect(isGrowthStoreTempFileName(name), name).toBe(true);
    for (const name of [
      `automation.${UUID}.tmp`, `jobs.json.${UUID}.tmp`, // 付费回执临时文件不自动清理
      "current.json", "current.json.gz", "123-1.next", "history-ledger.json.next", "a.json.tmp",
      "douyin.json.next-123-1763450000000", ".growth-platform-collection.lock", "notes.1.tmp",
    ]) expect(isGrowthStoreTempFileName(name), name).toBe(false);
  });

  it("只删过期临时文件；保留新鲜临时文件、数据文件、目录、符号链接与 backups/archive", async () => {
    const stale = [
      path.join(root, "current.json.1.1763450000000.abc.next"),
      path.join(root, "platform-current", "douyin.current.json.gz.1.1763450000000.zz.next"),
    ];
    for (const file of stale) await put(file, "0123456789");
    const fresh = path.join(root, "runtime-meta.json.1.1763450000000.abc.next");
    await put(fresh, "x", 5 * 60 * 1000);
    const data = path.join(root, "current.json");
    await put(data);
    const dirLike = path.join(root, "platforms", "dir.json.1.1763450000000.abc.next");
    await fs.mkdir(dirLike, { recursive: true });
    const linkTarget = path.join(os.tmpdir(), `growth-temp-sweep-target-${process.pid}`);
    await put(linkTarget);
    const link = path.join(root, "link.json.1.1763450000000.abc.next");
    await fs.symlink(linkTarget, link);
    const linkedDir = path.join(root, "linked");
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "growth-temp-sweep-outside-"));
    const outsideTemp = path.join(outside, "x.json.1.1763450000000.abc.next");
    await put(outsideTemp);
    await fs.symlink(outside, linkedDir);
    const protectedFiles = [
      path.join(root, "backups", "growth-debug-summary.json.1.1763450000000.abc.next"),
      path.join(root, "backups", "archive-offload", "123-1.next", "a.json.1.1763450000000.abc.next"),
      path.join(root, "archive", "2026-11", "x.json.gz.1.1763450000000.abc.next"),
      path.join(root, "platform-current", "archive", "y.json.1.1763450000000.abc.next"),
      path.join(root, "paid-research", "guaikei", `automation.${UUID}.tmp`),
      path.join(root, "paid-research", "guaikei", "index.json.1.1763450000000.abc.next"),
    ];
    for (const file of protectedFiles) await put(file);

    try {
      const result = await sweepGrowthStoreStaleTempFiles();
      expect(result).toEqual({ removed: 2, bytes: 20 });
      for (const file of stale) expect(await exists(file), file).toBe(false);
      for (const file of [fresh, data, dirLike, link, linkTarget, outsideTemp, ...protectedFiles]) {
        expect(await exists(file), file).toBe(true);
      }
    } finally {
      await fs.rm(linkTarget, { force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("清扫内部失败不抛出", async () => {
    await put(path.join(root, "current.json.1.1763450000000.abc.next"));
    vi.spyOn(fs, "unlink").mockRejectedValue(Object.assign(new Error("EROFS"), { code: "EROFS" }));
    await expect(sweepGrowthStoreStaleTempFiles()).resolves.toEqual({ removed: 0, bytes: 0 });
    vi.spyOn(fs, "readdir").mockImplementation(() => { throw new Error("boom"); });
    await expect(sweepGrowthStoreStaleTempFiles()).resolves.toEqual({ removed: 0, bytes: 0 });
    await expect(sweepGrowthStoreStaleTempFiles({ root: path.join(root, "missing") })).resolves.toEqual({ removed: 0, bytes: 0 });
  });
});
