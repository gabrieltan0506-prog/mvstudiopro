#!/usr/bin/env node

import fs from "node:fs/promises";

const [baselinePath, beforePath, afterPath] = process.argv.slice(2);

function num(value) {
  return Number(value || 0);
}

function shouldEnforceArchivedGuard() {
  return /^(1|true|yes)$/i.test(String(process.env.GROWTH_ENFORCE_ARCHIVED_MONOTONIC || "0").trim());
}

function currentToleranceRatio() {
  const raw = Number(process.env.GROWTH_CURRENT_MONOTONIC_TOLERANCE_RATIO || 0.1);
  if (!Number.isFinite(raw)) return 0.1;
  return Math.min(0.5, Math.max(0, raw));
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export function resolveGuardPlatforms(baseline, before, after) {
  const configured = Array.isArray(baseline?.activePlatforms)
    ? baseline.activePlatforms
        .map((platform) => String(platform || "").trim())
        .filter(Boolean)
    : [];
  if (configured.length) return new Set(configured);

  // 兼容尚未声明 activePlatforms 的旧基线：继续沿用原来的全平台并集语义。
  return new Set([
    ...Object.keys(baseline?.platforms || {}),
    ...Object.keys(before?.platforms || {}),
    ...Object.keys(after?.platforms || {}),
  ]);
}

export function findGrowthMonotonicRegressions({
  baseline,
  before,
  after,
  enforceArchived = false,
  currentTolerance = 0.1,
}) {
  const platformNames = resolveGuardPlatforms(baseline, before, after);
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
    const allowedCurrentFloor = Math.floor(floorCurrent * (1 - currentTolerance));
    if (actualCurrent < allowedCurrentFloor) {
      regressions.push(
        `${platform}: currentTotal regressed ${actualCurrent} < ${allowedCurrentFloor} (floor ${floorCurrent}, tolerance ${Math.round(currentTolerance * 100)}%)`,
      );
    }
    if (enforceArchived && actualArchived < floorArchived) {
      regressions.push(
        `${platform}: archivedTotal regressed ${actualArchived} < ${floorArchived}`,
      );
    }
  }

  return regressions;
}

async function main() {
  if (!baselinePath || !beforePath || !afterPath) {
    throw new Error("Usage: node scripts/verify-growth-monotonic.mjs <baseline-json> <before-json> <after-json>");
  }
  const [baseline, before, after] = await Promise.all([
    readJson(baselinePath),
    readJson(beforePath),
    readJson(afterPath),
  ]);

  const enforceArchived = shouldEnforceArchivedGuard();
  const currentTolerance = currentToleranceRatio();
  const regressions = findGrowthMonotonicRegressions({
    baseline,
    before,
    after,
    enforceArchived,
    currentTolerance,
  });

  if (regressions.length) {
    console.error("Growth monotonic guard failed:");
    for (const line of regressions) console.error(`- ${line}`);
    process.exit(1);
  }

  console.log("Growth monotonic guard passed.");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
