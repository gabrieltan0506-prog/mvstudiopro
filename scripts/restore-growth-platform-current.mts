import fs from "node:fs/promises";
import path from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

import { activeGrowthPlatformValues, type GrowthPlatform } from "@shared/growth";
import type { PlatformTrendCollection } from "../server/growth/trendCollector";
import { restoreTrendPlatformCurrentFromBaseline } from "../server/growth/trendStore";

const gunzipAsync = promisify(gunzip);

async function readBaseline(filePath: string): Promise<PlatformTrendCollection> {
  const raw = await fs.readFile(filePath);
  const json = filePath.endsWith(".gz") ? await gunzipAsync(raw) : raw;
  const parsed = JSON.parse(json.toString("utf8")) as {
    collection?: PlatformTrendCollection;
  } & Partial<PlatformTrendCollection>;
  const collection = parsed.collection || parsed as PlatformTrendCollection;
  if (!collection?.platform || !Array.isArray(collection.items)) {
    throw new Error("growth_restore_invalid_baseline");
  }
  return collection;
}

async function main() {
  const [platformArg, baselineArg, mode] = process.argv.slice(2);
  const platform = String(platformArg || "").trim() as GrowthPlatform;
  if (!activeGrowthPlatformValues.includes(platform as typeof activeGrowthPlatformValues[number])) {
    throw new Error(`growth_restore_invalid_platform:${platform}`);
  }
  if (!baselineArg) {
    throw new Error("Usage: tsx scripts/restore-growth-platform-current.mts <platform> <baseline.json[.gz]> --apply");
  }
  if (mode !== "--apply") {
    throw new Error("growth_restore_apply_flag_required");
  }
  const baselinePath = path.resolve(baselineArg);
  const baseline = await readBaseline(baselinePath);
  const result = await restoreTrendPlatformCurrentFromBaseline(platform, baseline);
  console.log(JSON.stringify({ ok: true, baselinePath, ...result }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
