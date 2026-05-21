import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GrowthPlatform } from "@shared/growth";
import type { PlatformTrendCollection } from "./trendCollector";

const ORIGINAL_STORE_DIR = process.env.GROWTH_STORE_DIR;

describe("growth store split + gzip layout", () => {
  let tempRoot = "";

  beforeEach(async () => {
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

  it("migrates embedded items into platform-current gzip and slims current.json", async () => {
    const {
      detectGrowthStoreMigrationNeeds,
      migrateGrowthStoreSplitGzipLayout,
      readTrendStore,
    } = await import("./trendStore");

    const platform = "douyin" as GrowthPlatform;
    const collection: PlatformTrendCollection = {
      platform,
      source: "live",
      collectedAt: new Date().toISOString(),
      windowDays: 30,
      items: [{
        id: "dy-1",
        title: "测试条目",
        bucket: "douyin_feed",
        likes: 10,
      }],
      stats: {
        platform,
        itemCount: 1,
        uniqueAuthorCount: 1,
        bucketCounts: { douyin_feed: 1 },
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

    await fs.writeFile(
      path.join(tempRoot, "current.json"),
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        collections: { [platform]: collection },
        scheduler: {},
        archiveIndex: [],
      }),
      "utf8",
    );

    const before = await detectGrowthStoreMigrationNeeds();
    expect(before.needed).toBe(true);
    expect(before.reasons.some((reason) => reason.includes("embedded_items"))).toBe(true);

    const report = await migrateGrowthStoreSplitGzipLayout({ migrateArchives: false });
    expect(report.migrated).toBe(true);
    expect(report.platformsRewritten).toContain(platform);

    const truthGz = path.join(tempRoot, "platform-current", `${platform}.current.json.gz`);
    const truthRaw = gunzipSync(await fs.readFile(truthGz));
    const truth = JSON.parse(truthRaw.toString("utf8")) as { collection?: PlatformTrendCollection };
    expect(truth.collection?.items?.length).toBe(1);

    const currentRaw = JSON.parse(await fs.readFile(path.join(tempRoot, "current.json"), "utf8")) as {
      collections?: Record<string, PlatformTrendCollection>;
    };
    expect(currentRaw.collections?.[platform]?.items?.length || 0).toBe(0);
    expect((currentRaw.collections?.[platform]?.notes || []).join(" ")).toContain("items_externalized");

    const hydrated = await readTrendStore({ preferDerivedFiles: true });
    expect(hydrated.collections?.[platform]?.items?.length).toBe(1);

    const after = await detectGrowthStoreMigrationNeeds();
    expect(after.needed).toBe(false);
  });
});
