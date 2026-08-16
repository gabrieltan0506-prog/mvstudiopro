#!/usr/bin/env node

import fs from "node:fs/promises";

import {
  findGrowthMonotonicRegressions,
  hasGrowthMonotonicRegressionForPlatform,
} from "./verify-growth-monotonic.mjs";

const [baselinePath, beforePath, afterPath, platform] = process.argv.slice(2);

async function main() {
  if (!baselinePath || !beforePath || !afterPath || !platform) {
    throw new Error(
      "Usage: node scripts/check-growth-platform-restore.mjs <baseline-json> <before-json> <after-json> <platform>",
    );
  }
  const [baseline, before, after] = await Promise.all(
    [baselinePath, beforePath, afterPath].map(async (file) => (
      JSON.parse(await fs.readFile(file, "utf8"))
    )),
  );
  const regressions = findGrowthMonotonicRegressions({ baseline, before, after });
  const required = hasGrowthMonotonicRegressionForPlatform(regressions, platform);
  const minimumRestoreItems = Math.max(
    Number(baseline?.platforms?.[platform]?.currentTotal || 0),
    Number(before?.platforms?.[platform]?.currentTotal || 0),
  );
  console.log(JSON.stringify({ platform, required, minimumRestoreItems, regressions }));
  process.exitCode = required ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
