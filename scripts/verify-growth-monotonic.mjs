#!/usr/bin/env node

import fs from "node:fs/promises";

const [baselinePath, beforePath, afterPath] = process.argv.slice(2);

if (!baselinePath || !beforePath || !afterPath) {
  console.error("Usage: node scripts/verify-growth-monotonic.mjs <baseline-json> <before-json> <after-json>");
  process.exit(1);
}

function num(value) {
  return Number(value || 0);
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function main() {
  const [baseline, before, after] = await Promise.all([
    readJson(baselinePath),
    readJson(beforePath),
    readJson(afterPath),
  ]);

  const platformNames = new Set([
    ...Object.keys(baseline.platforms || {}),
    ...Object.keys(before.platforms || {}),
    ...Object.keys(after.platforms || {}),
  ]);

  const regressions = [];

  for (const platform of platformNames) {
    const floorCurrent = Math.max(
      num(baseline.platforms?.[platform]?.currentTotal),
      num(before.platforms?.[platform]?.currentTotal),
    );
    const floorArchived = Math.max(
      num(baseline.platforms?.[platform]?.archivedTotal),
      num(before.platforms?.[platform]?.archivedTotal),
    );
    const actualCurrent = num(after.platforms?.[platform]?.currentTotal);
    const actualArchived = num(after.platforms?.[platform]?.archivedTotal);
    if (actualCurrent < floorCurrent) {
      regressions.push(
        `${platform}: currentTotal regressed ${actualCurrent} < ${floorCurrent}`,
      );
    }
    if (actualArchived < floorArchived) {
      regressions.push(
        `${platform}: archivedTotal regressed ${actualArchived} < ${floorArchived}`,
      );
    }
  }

  if (regressions.length) {
    console.error("Growth monotonic guard failed:");
    for (const line of regressions) console.error(`- ${line}`);
    process.exit(1);
  }

  console.log("Growth monotonic guard passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
