import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformTrendCollection } from "./trendCollector";

// 用例体内 await import("./trendStore") 大模块，导入成本计入用例预算（实测安静机器已 4.8s），全量跑时 5s 默认线会被踩爆
vi.setConfig({ testTimeout: 60_000 });

/**
 * 回归：热窗裁剪（#995）曾被 writeStore 的「防缩保护」整体换回旧档——
 * merged 池因 prune 变小（< existing），allowLowerTotals 默认 false 就把
 * 旧的 365 天集合原样写回，collectedAt 永久冻结（douyin 卡 07-26 实案）。
 * merge 语义下池子只会因裁剪而变小（dedupe 只增不减），故 merge 路径放行缩小。
 */

const ORIGINAL_STORE_DIR = process.env.GROWTH_STORE_DIR;
const ORIGINAL_WINDOW = process.env.GROWTH_TARGET_WINDOW_DAYS;

function makeItem(id: string, publishedAt: string) {
  return {
    id,
    title: `条目 ${id}`,
    bucket: "douyin_feed",
    likes: 100,
    publishedAt,
    platform: "douyin",
  };
}

function makeCollection(items: ReturnType<typeof makeItem>[], collectedAt: string): PlatformTrendCollection {
  return {
    platform: "douyin",
    source: "live",
    collectedAt,
    windowDays: 365,
    items: items as PlatformTrendCollection["items"],
    stats: {
      platform: "douyin",
      itemCount: items.length,
      uniqueAuthorCount: 1,
      bucketCounts: { douyin_feed: items.length },
      requestCount: 1,
      pageDepth: 1,
      targetPerRun: items.length,
      referenceMinItems: 1,
      referenceMaxItems: items.length,
      collectorMode: "seed",
      industryCounts: {},
      ageCounts: {},
      contentCounts: {},
    },
    notes: [],
  };
}

describe("growth store merge + hot-window prune", () => {
  let tempRoot = "";

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "growth-merge-prune-"));
    process.env.GROWTH_STORE_DIR = tempRoot;
    process.env.GROWTH_WRITE_LEGACY_MIRROR = "0";
    process.env.GROWTH_WRITE_DERIVED_PLATFORM_FILES = "1";
    process.env.GROWTH_DISABLE_STORE_LAYOUT_MIGRATE = "1";
    process.env.GROWTH_TARGET_WINDOW_DAYS = "90";
  });

  afterEach(async () => {
    if (ORIGINAL_STORE_DIR) process.env.GROWTH_STORE_DIR = ORIGINAL_STORE_DIR;
    else delete process.env.GROWTH_STORE_DIR;
    if (ORIGINAL_WINDOW) process.env.GROWTH_TARGET_WINDOW_DAYS = ORIGINAL_WINDOW;
    else delete process.env.GROWTH_TARGET_WINDOW_DAYS;
    delete process.env.GROWTH_DISABLE_STORE_LAYOUT_MIGRATE;
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("merge 后热窗裁剪真正落盘：缩小不被防缩保护换回旧档", async () => {
    const { mergeTrendCollections, readTrendStore } = await import("./trendStore");

    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    // 旧池：100 条全部在 90 天窗之外（200 天前）
    const oldItems = Array.from({ length: 100 }, (_, i) =>
      makeItem(`old-${i}`, new Date(now - 200 * day).toISOString()),
    );
    const staleCollectedAt = new Date(now - 2 * day).toISOString();
    await fs.writeFile(
      path.join(tempRoot, "current.json"),
      JSON.stringify({
        updatedAt: staleCollectedAt,
        collections: { douyin: makeCollection(oldItems, staleCollectedAt) },
        scheduler: {},
        archiveIndex: [],
      }),
      "utf8",
    );

    // 新一轮采集：10 条热条目
    const freshCollectedAt = new Date(now).toISOString();
    const incoming = makeCollection(
      Array.from({ length: 10 }, (_, i) => makeItem(`new-${i}`, new Date(now - day).toISOString())),
      freshCollectedAt,
    );

    const result = await mergeTrendCollections({ douyin: incoming });
    const stat = result.mergeStats?.douyin;
    expect(stat?.prunedFromCount).toBe(100);
    expect(stat?.currentTotal).toBeLessThan(100);

    const store = await readTrendStore();
    const douyin = store.collections?.douyin;
    // collectedAt 必须跟进新一轮，而不是冻结在旧档
    expect(douyin?.collectedAt).toBe(freshCollectedAt);
    // 90 天窗外的 100 条旧条目必须被裁掉，只留 10 条新
    expect(douyin?.items.map((it) => it.id).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `new-${i}`).sort(),
    );
    expect(douyin?.items.every((it) => it.observedAt === freshCollectedAt)).toBe(true);
    expect(douyin?.windowDays).toBe(90);

    // 再读 derived 真相文件，确认落盘的不是内存幻象
    const derived = await readTrendStore({ preferDerivedFiles: true });
    expect(derived.collections?.douyin?.collectedAt).toBe(freshCollectedAt);
    expect(derived.collections?.douyin?.items.length).toBe(10);
  });

  it("窗口内旧条目 + 新条目 merge 后只增不减（防缩保护本来防的场景）", async () => {
    const { mergeTrendCollections, readTrendStore } = await import("./trendStore");

    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const oldItems = Array.from({ length: 30 }, (_, i) =>
      makeItem(`keep-${i}`, new Date(now - 10 * day).toISOString()),
    );
    await fs.writeFile(
      path.join(tempRoot, "current.json"),
      JSON.stringify({
        updatedAt: new Date(now - day).toISOString(),
        collections: { douyin: makeCollection(oldItems, new Date(now - day).toISOString()) },
        scheduler: {},
        archiveIndex: [],
      }),
      "utf8",
    );

    const incoming = makeCollection(
      [makeItem("fresh-1", new Date(now).toISOString())],
      new Date(now).toISOString(),
    );
    await mergeTrendCollections({ douyin: incoming });

    const store = await readTrendStore();
    const ids = store.collections?.douyin?.items.map((it) => it.id) || [];
    expect(ids).toContain("fresh-1");
    expect(ids.filter((id) => id.startsWith("keep-"))).toHaveLength(30);
  });

  it("受控恢复以完整基线为底并保留基线后的新观测，不改其他平台", async () => {
    const {
      readTrendStore,
      restoreTrendPlatformCurrentFromBaseline,
    } = await import("./trendStore");
    const now = Date.now();
    const baselineAt = new Date(now - 60_000).toISOString();
    const liveAt = new Date(now).toISOString();
    const baseline = makeCollection([
      makeItem("base-1", baselineAt),
      makeItem("shared", baselineAt),
    ], baselineAt);
    baseline.platform = "xiaohongshu";
    const live = makeCollection([
      { ...makeItem("shared", liveAt), likes: 999 },
      makeItem("post-baseline", liveAt),
    ], liveAt);
    live.platform = "xiaohongshu";
    const other = makeCollection([makeItem("other-platform", liveAt)], liveAt);
    await fs.writeFile(
      path.join(tempRoot, "current.json"),
      JSON.stringify({
        updatedAt: liveAt,
        collections: { xiaohongshu: live, douyin: other },
        scheduler: {},
        archiveIndex: [],
      }),
      "utf8",
    );

    const backupDir = path.join(tempRoot, "restore-temp");
    const result = await restoreTrendPlatformCurrentFromBaseline("xiaohongshu", baseline, {
      apply: true,
      minimumBaselineItems: 2,
      backupDir,
    });
    expect(result).toMatchObject({
      baselineCount: 2,
      baselineUniqueCount: 2,
      liveCount: 2,
      restoredCount: 3,
      addedAfterBaseline: 1,
      missingBaselineCount: 0,
      applied: true,
      verifiedCount: 3,
    });
    expect(result.backupPath).toMatch(/xiaohongshu-before-restore-.+\.json\.gz$/);
    await expect(fs.access(String(result.backupPath))).resolves.toBeUndefined();
    const store = await readTrendStore({ preferDerivedFiles: true });
    expect(store.collections?.xiaohongshu?.items.map((item) => item.id).sort()).toEqual([
      "base-1",
      "post-baseline",
      "shared",
    ]);
    expect(store.collections?.xiaohongshu?.items.find((item) => item.id === "shared")?.likes).toBe(999);
    expect(store.collections?.douyin?.items.map((item) => item.id)).toEqual(["other-platform"]);
  });

  it("受控恢复默认 dry-run，且拒绝低于最低条数的伪基线", async () => {
    const {
      readTrendStore,
      restoreTrendPlatformCurrentFromBaseline,
    } = await import("./trendStore");
    const collectedAt = new Date().toISOString();
    const baseline = makeCollection([makeItem("base-1", collectedAt)], collectedAt);
    baseline.platform = "xiaohongshu";
    await fs.writeFile(
      path.join(tempRoot, "current.json"),
      JSON.stringify({
        updatedAt: collectedAt,
        collections: { xiaohongshu: makeCollection([makeItem("live-1", collectedAt)], collectedAt) },
        scheduler: {},
        archiveIndex: [],
      }),
      "utf8",
    );

    await expect(restoreTrendPlatformCurrentFromBaseline("xiaohongshu", baseline, {
      minimumBaselineItems: 2,
    })).rejects.toThrow("growth_restore_baseline_below_minimum:xiaohongshu:unique=1:minimum=2");
    await expect(restoreTrendPlatformCurrentFromBaseline("xiaohongshu", baseline, {
      minimumBaselineItems: Number.NaN,
    })).rejects.toThrow("growth_restore_invalid_minimum:xiaohongshu:NaN");

    const result = await restoreTrendPlatformCurrentFromBaseline("xiaohongshu", baseline, {
      minimumBaselineItems: 1,
    });
    expect(result).toMatchObject({ applied: false, restoredCount: 2, liveCount: 1 });
    const store = await readTrendStore({ preferDerivedFiles: true });
    expect(store.collections?.xiaohongshu?.items.map((item) => item.id)).toEqual(["live-1"]);
  });
});
