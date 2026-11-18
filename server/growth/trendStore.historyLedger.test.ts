import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformTrendCollection } from "./trendCollector";

vi.setConfig({ testTimeout: 60_000 });

/**
 * history-ledger 防丢：读坏的现存账本绝不当空覆盖；新形态为流式 gzip；
 * 旧 .json 只在新 .json.gz 回读校验通过后删除；两种形态并存时按并集确定性读取。
 */

const ORIGINAL_STORE_DIR = process.env.GROWTH_STORE_DIR;
const ORIGINAL_HISTORY_UPDATES = process.env.GROWTH_DISABLE_HISTORY_LEDGER_UPDATES;

function makeItem(id: string, publishedAt: string) {
  return { id, title: `条目 ${id}`, bucket: "douyin_feed", likes: 100, publishedAt, platform: "douyin" };
}

function makeCollection(ids: string[], collectedAt: string): PlatformTrendCollection {
  const items = ids.map(id => makeItem(id, collectedAt));
  return {
    platform: "douyin",
    source: "live",
    collectedAt,
    windowDays: 365,
    items: items as PlatformTrendCollection["items"],
    stats: {
      platform: "douyin", itemCount: items.length, uniqueAuthorCount: 1, bucketCounts: { douyin_feed: items.length },
      requestCount: 1, pageDepth: 1, targetPerRun: items.length, referenceMinItems: 1, referenceMaxItems: items.length,
      collectorMode: "seed", industryCounts: {}, ageCounts: {}, contentCounts: {},
    },
    notes: [],
  };
}

function ledgerEntry(key: string, at: string) {
  return { key, bucket: "douyin_feed", industryLabels: [], ageLabels: [], contentLabels: [], firstSeenAt: at, lastSeenAt: at };
}

function legacyLedger(keys: string[], at: string) {
  return { updatedAt: at, platform: "douyin", items: Object.fromEntries(keys.map(key => [key, ledgerEntry(key, at)])) };
}

describe("growth history-ledger 持久化", () => {
  let tempRoot = "";
  let ledgerDir = "";
  let plainFile = "";
  let gzFile = "";

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "growth-history-ledger-"));
    ledgerDir = path.join(tempRoot, "history-ledger");
    plainFile = path.join(ledgerDir, "douyin.json");
    gzFile = `${plainFile}.gz`;
    process.env.GROWTH_STORE_DIR = tempRoot;
    process.env.GROWTH_WRITE_LEGACY_MIRROR = "0";
    process.env.GROWTH_WRITE_DERIVED_PLATFORM_FILES = "1";
    process.env.GROWTH_DISABLE_STORE_LAYOUT_MIGRATE = "1";
    process.env.GROWTH_DISABLE_HISTORY_LEDGER_UPDATES = "0";
    await fs.mkdir(ledgerDir, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (ORIGINAL_STORE_DIR) process.env.GROWTH_STORE_DIR = ORIGINAL_STORE_DIR;
    else delete process.env.GROWTH_STORE_DIR;
    delete process.env.GROWTH_DISABLE_STORE_LAYOUT_MIGRATE;
    if (ORIGINAL_HISTORY_UPDATES) process.env.GROWTH_DISABLE_HISTORY_LEDGER_UPDATES = ORIGINAL_HISTORY_UPDATES;
    else delete process.env.GROWTH_DISABLE_HISTORY_LEDGER_UPDATES;
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  });

  async function ledgerKeys() {
    const m = await import("./trendStore");
    return Object.keys(await m.readLocalHistoryLedgerForStats("douyin")).sort();
  }

  it("ENOENT 从空账本起步，写出 gzip 新形态且可完整回读", async () => {
    const m = await import("./trendStore");
    const at = new Date().toISOString();
    await m.mergeTrendCollections({ douyin: makeCollection(["a", "b"], at) });
    expect(await fs.readdir(ledgerDir)).toEqual(["douyin.json.gz"]);
    const stream = await import("./growthJsonStream");
    const seen: string[] = [];
    const result = await stream.readGrowthJsonItemsStream(gzFile, { gzip: true, onItem: key => { seen.push(key); } });
    expect(result.fields.platform).toBe("douyin");
    expect(seen.length).toBe(2);
    await m.mergeTrendCollections({ douyin: makeCollection(["c"], at) });
    expect((await ledgerKeys()).length).toBe(3);
    expect(await fs.readdir(ledgerDir)).toEqual(["douyin.json.gz"]);
  });

  it("现存账本读不出（损坏 gzip / 截断旧 json）时不覆盖：采集照常落盘，账本读取报错且原文件逐字节不变", async () => {
    const at = new Date().toISOString();
    for (const [file, bytes] of [
      [gzFile, Buffer.from("not-gzip")],
      [plainFile, Buffer.from(JSON.stringify(legacyLedger(["x", "y"], at), null, 2).slice(0, -20))],
      [gzFile, gzipSync(Buffer.from(JSON.stringify({ updatedAt: at, platform: "douyin" })))],
    ] as const) {
      vi.resetModules();
      await fs.rm(ledgerDir, { recursive: true, force: true });
      await fs.mkdir(ledgerDir, { recursive: true });
      await fs.writeFile(file, bytes);
      const m = await import("./trendStore");
      await m.mergeTrendCollections({ douyin: makeCollection(["new"], at) });
      await expect(m.readLocalHistoryLedgerForStats("douyin")).rejects.toThrow(/growth_store_file_unreadable/);
      expect(await fs.readFile(file)).toEqual(bytes);
      expect(await fs.readdir(ledgerDir)).toEqual([path.basename(file)]);
    }
  });

  it("旧缩进 .json 迁移：新 .gz 回读校验通过才删旧文件，记录一条不少", async () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    const oldKeys = Array.from({ length: 3000 }, (_, i) => `douyin:old-${i}`);
    await fs.writeFile(plainFile, JSON.stringify(legacyLedger(oldKeys, at), null, 2));
    const m = await import("./trendStore");
    await m.mergeTrendCollections({ douyin: makeCollection(["fresh"], new Date().toISOString()) });
    expect(await fs.readdir(ledgerDir)).toEqual(["douyin.json.gz"]);
    const keys = await ledgerKeys();
    expect(keys.length).toBe(3001);
    for (const key of oldKeys) expect(keys).toContain(key);
  });

  it("迁移校验不通过时保留旧 .json 并报错，下次读取两份合并不丢", async () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    const oldKeys = ["douyin:o1", "douyin:o2", "douyin:o3"];
    const legacyBytes = Buffer.from(JSON.stringify(legacyLedger(oldKeys, at), null, 2));
    await fs.writeFile(plainFile, legacyBytes);
    const stream = await import("./growthJsonStream");
    const original = stream.writeGrowthGzipJson;
    // 模拟写出的新文件少了记录（磁盘/序列化异常）
    vi.spyOn(stream, "writeGrowthGzipJson").mockImplementation(async (plain, value, options) => {
      const ledger = value as { items?: Record<string, unknown> };
      if (String(plain).endsWith(path.join("history-ledger", "douyin.json")) && ledger.items) {
        const { "douyin:o1": _dropped, ...rest } = ledger.items;
        return original(plain, { ...ledger, items: rest }, options);
      }
      return original(plain, value, options);
    });
    const m = await import("./trendStore");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await m.mergeTrendCollections({ douyin: makeCollection(["fresh"], new Date().toISOString()) });
    expect(String(errors.mock.calls.flat().join(" "))).toMatch(/growth_history_ledger_migration_unverified/);
    expect(await fs.readFile(plainFile)).toEqual(legacyBytes);
    vi.restoreAllMocks();
    expect((await fs.readdir(ledgerDir)).sort()).toEqual(["douyin.json", "douyin.json.gz"]);
    const keys = await ledgerKeys();
    for (const key of oldKeys) expect(keys).toContain(key);
  });

  it("旧 .json 与新 .json.gz 并存时按并集确定性读取，陈旧一方遮蔽不了另一方", async () => {
    const early = "2026-01-01T00:00:00.000Z";
    const late = "2026-06-01T00:00:00.000Z";
    // gz 陈旧（只有 a、b），旧 json 更新（回滚期间写入 b、c）
    const gzValue = legacyLedger(["douyin:a", "douyin:b"], early);
    await fs.writeFile(gzFile, gzipSync(Buffer.from(JSON.stringify(gzValue))));
    const plainValue = legacyLedger(["douyin:b", "douyin:c"], late);
    await fs.writeFile(plainFile, JSON.stringify(plainValue, null, 2));
    const first = await ledgerKeys();
    vi.resetModules();
    const second = await ledgerKeys();
    expect(first).toEqual(["douyin:a", "douyin:b", "douyin:c"]);
    expect(second).toEqual(first);
    const m = await import("./trendStore");
    const merged = await m.readLocalHistoryLedgerForStats("douyin");
    expect(merged["douyin:b"].firstSeenAt).toBe(early);
    expect(merged["douyin:b"].lastSeenAt).toBe(late);
    // 下一次写入后两份合一，旧 json 校验通过才删除
    await m.mergeTrendCollections({ douyin: makeCollection(["d"], new Date().toISOString()) });
    expect(await fs.readdir(ledgerDir)).toEqual(["douyin.json.gz"]);
    expect((await ledgerKeys()).length).toBe(4);
  });

  it("platform-current 真值文件读坏时 merge 报错，不用新批次覆盖或删除它", async () => {
    const at = new Date().toISOString();
    const m = await import("./trendStore");
    await m.mergeTrendCollections({ douyin: makeCollection(["a", "b", "c"], at) });
    const truthFile = path.join(tempRoot, "platform-current", "douyin.current.json.gz");
    const broken = Buffer.from("broken-gzip");
    await fs.writeFile(truthFile, broken);
    vi.resetModules();
    const fresh = await import("./trendStore");
    await expect(fresh.mergeTrendCollections({ douyin: makeCollection(["z"], at) })).rejects.toThrow(/growth_store_file_unreadable/);
    expect(await fs.readFile(truthFile)).toEqual(broken);
  });

  it("单个平台账本读不出时只跳过该平台账本：采集照常落盘，其它平台账本照常更新，坏文件逐字节不变", async () => {
    const at = new Date().toISOString();
    const broken = Buffer.from("not-gzip");
    await fs.writeFile(gzFile, broken);
    const m = await import("./trendStore");
    const bilibili = { ...makeCollection(["b1"], at), platform: "bilibili" } as PlatformTrendCollection;
    await m.mergeTrendCollections({ douyin: makeCollection(["new-1", "new-2"], at), bilibili });
    expect(await fs.readFile(gzFile)).toEqual(broken);
    const store = await m.readTrendStore();
    expect(store.collections.douyin?.items.map(item => item.id).sort()).toEqual(["new-1", "new-2"]);
    expect(Object.keys(await m.readLocalHistoryLedgerForStats("bilibili"))).toEqual(["b1"]);
  });

  it("读账本时另一写者恰好完成迁移（删旧 .json）不报读坏，读到完整新文件", async () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    const value = legacyLedger(["douyin:r1", "douyin:r2"], at);
    await fs.writeFile(plainFile, JSON.stringify(value, null, 2));
    const stream = await import("./growthJsonStream");
    const original = stream.readGrowthJsonItemsStream;
    let raced = false;
    vi.spyOn(stream, "readGrowthJsonItemsStream").mockImplementation(async (file, options) => {
      if (!raced && file === plainFile) {
        raced = true;
        // 模拟并发写者：stat 之后、打开之前写好新 .gz 并删掉旧 .json
        await fs.writeFile(gzFile, gzipSync(Buffer.from(JSON.stringify(value))));
        await fs.rm(plainFile);
      }
      return original(file, options);
    });
    const m = await import("./trendStore");
    expect(Object.keys(await m.readLocalHistoryLedgerForStats("douyin")).sort()).toEqual(["douyin:r1", "douyin:r2"]);
    expect(raced).toBe(true);
  });

  it("reconcile force 不清空现有账本", async () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    const m = await import("./trendStore");
    await m.mergeTrendCollections({ douyin: makeCollection(["live-1"], at) });
    const extra = legacyLedger(["douyin:only-in-ledger"], at);
    const stream = await import("./growthJsonStream");
    const current = await m.readLocalHistoryLedgerForStats("douyin");
    await stream.writeGrowthGzipJson(plainFile, { ...extra, items: { ...current, ...extra.items } });
    await m.reconcileTrendHistoryState({ force: true });
    expect(await ledgerKeys()).toContain("douyin:only-in-ledger");
  });
});

describe("账本合并规则单一真源", () => {
  it("共享 .mjs 的标签归一与 trendNormalize.normalizeStringList 输出一致", async () => {
    const { normalizeLedgerLabels } = await import("./growthJsonStreamLedger.mjs");
    const { normalizeStringList } = await import("./trendNormalize");
    for (const value of [["a", " b ", "a", "", null, 0, 3], "x|y, z,,x", "", undefined, null, 5, { a: 1 }, [" 美食 ", "美食", "短剧"]]) {
      expect(normalizeLedgerLabels(value)).toEqual(normalizeStringList(value));
    }
  });
});
