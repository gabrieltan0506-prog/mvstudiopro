import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { growthPlatformValues, type GrowthPlatform } from "@shared/growth";
import type { PlatformTrendCollection } from "./trendCollector";

const ORIGINAL_STORE_DIR = process.env.GROWTH_STORE_DIR;
const TEST_PLATFORMS = ["douyin", "xiaohongshu", "kuaishou", "bilibili", "toutiao", "weixin_channels"] as const;

function createCollection(platform: GrowthPlatform, suffix: string): PlatformTrendCollection {
  return {
    platform,
    source: "live",
    collectedAt: new Date().toISOString(),
    windowDays: 30,
    items: [{
      id: `${platform}-${suffix}`,
      title: `${platform} 测试 ${suffix}`,
      bucket: `${platform}_feed`,
      likes: 10,
    }],
    stats: {
      platform,
      itemCount: 1,
      uniqueAuthorCount: 1,
      bucketCounts: { [`${platform}_feed`]: 1 },
      requestCount: 1,
      pageDepth: 1,
      targetPerRun: 1,
      referenceMinItems: 1,
      referenceMaxItems: 1,
      collectorMode: "test",
      industryCounts: {},
      ageCounts: {},
      contentCounts: {},
    },
  };
}

describe("growth store split + gzip layout", () => {
  let tempRoot = "";

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "growth-split-gzip-"));
    process.env.GROWTH_STORE_DIR = tempRoot;
    process.env.GROWTH_WRITE_LEGACY_MIRROR = "0";
    process.env.GROWTH_WRITE_DERIVED_PLATFORM_FILES = "1";
    process.env.GROWTH_DISABLE_STORE_LAYOUT_MIGRATE = "1";
    await fs.mkdir(path.join(tempRoot, "platform-current"), { recursive: true });
  });

  afterEach(async () => {
    if (ORIGINAL_STORE_DIR) process.env.GROWTH_STORE_DIR = ORIGINAL_STORE_DIR;
    else delete process.env.GROWTH_STORE_DIR;
    delete process.env.GROWTH_DISABLE_STORE_LAYOUT_MIGRATE;
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("migrates every growth platform into platform-current gzip", async () => {
    const {
      detectGrowthStoreMigrationNeeds,
      migrateGrowthStoreSplitGzipLayout,
      readTrendStore,
      readTrendStoreForPlatforms,
    } = await import("./trendStore");

    const collections = Object.fromEntries(
      TEST_PLATFORMS.map((platform) => [platform, createCollection(platform, "a")]),
    );

    await fs.writeFile(
      path.join(tempRoot, "current.json"),
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        collections,
        scheduler: {},
        archiveIndex: [],
      }),
      "utf8",
    );

    const before = await detectGrowthStoreMigrationNeeds();
    expect(before.needed).toBe(true);
    expect(TEST_PLATFORMS.every((platform) =>
      before.reasons.some((reason) => reason === `embedded_items:${platform}`),
    )).toBe(true);

    const report = await migrateGrowthStoreSplitGzipLayout({ migrateArchives: false });
    expect(report.migrated).toBe(true);
    expect(report.platformsRewritten.sort()).toEqual([...TEST_PLATFORMS].sort());

    for (const platform of TEST_PLATFORMS) {
      const truthGz = path.join(tempRoot, "platform-current", `${platform}.current.json.gz`);
      const truth = JSON.parse(gunzipSync(await fs.readFile(truthGz)).toString("utf8")) as {
        collection?: PlatformTrendCollection;
      };
      expect(truth.collection?.items?.length).toBe(1);
      await expect(fs.access(path.join(tempRoot, "platforms", `${platform}.json.gz`))).resolves.toBeUndefined();
    }

    const hydrated = await readTrendStore({ preferDerivedFiles: true });
    for (const platform of TEST_PLATFORMS) {
      expect(hydrated.collections?.[platform]?.items?.length).toBe(1);
    }

    const partial = await readTrendStoreForPlatforms(["douyin", "weixin_channels"], { preferDerivedFiles: true });
    expect(partial.collections?.douyin?.items?.length).toBe(1);
    expect(partial.collections?.weixin_channels?.items?.length).toBe(1);

    const after = await detectGrowthStoreMigrationNeeds();
    expect(after.needed).toBe(false);
  });

  it("reads partial platform-current truth without waiting for every platform file", async () => {
    const { gzipSync } = await import("node:zlib");
    const { readTrendStore } = await import("./trendStore");
    const readyPlatforms: GrowthPlatform[] = ["douyin", "bilibili"];
    const pendingPlatform: GrowthPlatform = "xiaohongshu";
    const updatedAt = new Date().toISOString();
    const pendingCollection = createCollection(pendingPlatform, "pending");

    for (const platform of readyPlatforms) {
      const payload = {
        updatedAt,
        truthSource: "platform-current",
        platform,
        collection: createCollection(platform, "ready"),
      };
      const truthPath = path.join(tempRoot, "platform-current", `${platform}.current.json.gz`);
      await fs.writeFile(truthPath, gzipSync(Buffer.from(JSON.stringify(payload), "utf8")));
    }

    await fs.writeFile(
      path.join(tempRoot, "current.json"),
      JSON.stringify({
        updatedAt,
        collections: {
          ...Object.fromEntries(readyPlatforms.map((platform) => [platform, {
            ...createCollection(platform, "ready"),
            items: [],
            notes: [`items_externalized:platform-current/${platform}.current.json.gz`],
          }])),
          [pendingPlatform]: pendingCollection,
        },
        scheduler: {},
        archiveIndex: [],
        truthSource: "platform-current",
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, "platform-current-manifest.json"),
      JSON.stringify({
        updatedAt,
        truthSource: "platform-current",
        platforms: Object.fromEntries(readyPlatforms.map((platform) => [
          platform,
          { file: path.join(tempRoot, "platform-current", `${platform}.current.json.gz`), currentTotal: 1, archivedTotal: 0 },
        ])),
      }),
      "utf8",
    );

    const loaded = await readTrendStore({ preferDerivedFiles: true });
    expect(loaded.collections?.douyin?.items?.length).toBe(1);
    expect(loaded.collections?.bilibili?.items?.length).toBe(1);
    expect(loaded.collections?.xiaohongshu?.items?.length).toBe(1);
    expect(growthPlatformValues).toEqual(expect.arrayContaining(TEST_PLATFORMS));
  });
});
