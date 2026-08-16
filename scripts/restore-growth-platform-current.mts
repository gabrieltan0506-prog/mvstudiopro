import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
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
  const [platformArg, baselineArg, ...flags] = process.argv.slice(2);
  const platform = String(platformArg || "").trim() as GrowthPlatform;
  if (!activeGrowthPlatformValues.includes(platform as typeof activeGrowthPlatformValues[number])) {
    throw new Error(`growth_restore_invalid_platform:${platform}`);
  }
  if (!baselineArg) {
    throw new Error("Usage: tsx scripts/restore-growth-platform-current.mts <platform> <baseline.json[.gz]> --min-items=N [--backup-dir=DIR] [--apply]");
  }
  const supportedFlags = flags.filter((flag) => (
    flag === "--apply"
    || flag.startsWith("--min-items=")
    || flag.startsWith("--backup-dir=")
  ));
  if (supportedFlags.length !== flags.length) {
    throw new Error(`growth_restore_unknown_flag:${flags.find((flag) => !supportedFlags.includes(flag))}`);
  }
  const minimumBaselineItems = Number(
    flags.find((flag) => flag.startsWith("--min-items="))?.split("=").slice(1).join("="),
  );
  if (!Number.isFinite(minimumBaselineItems) || minimumBaselineItems < 1) {
    throw new Error("growth_restore_min_items_required");
  }
  const apply = flags.includes("--apply");
  const backupDirArg = flags.find((flag) => flag.startsWith("--backup-dir="))?.split("=").slice(1).join("=");
  const baselinePath = path.resolve(baselineArg);
  const baselineRaw = await fs.readFile(baselinePath);
  const baselineSha256 = createHash("sha256").update(baselineRaw).digest("hex");
  const baseline = await readBaseline(baselinePath);
  const result = await restoreTrendPlatformCurrentFromBaseline(platform, baseline, {
    apply,
    minimumBaselineItems,
    backupDir: backupDirArg ? path.resolve(backupDirArg) : undefined,
  });
  console.log(JSON.stringify({
    ok: true,
    mode: apply ? "apply" : "dry-run",
    baselinePath,
    baselineSha256,
    ...result,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
