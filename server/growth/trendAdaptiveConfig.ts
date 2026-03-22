import fs from "node:fs/promises";
import path from "node:path";
import { type GrowthPlatform } from "@shared/growth";
import { nowShanghaiIso } from "./time";

type AdaptiveRouteState = {
  key: string;
  lastRunAt?: string;
  lastYieldCount: number;
  lastRequestCount: number;
  totalRuns: number;
  totalYieldCount: number;
  totalRequestCount: number;
  consecutiveHits: number;
  consecutiveMisses: number;
  avgYieldPerRun: number;
  avgYieldPerRequest: number;
};

type AdaptiveSeedState = {
  key: string;
  lastUsedAt?: string;
  totalRuns: number;
  totalCredit: number;
  consecutiveHits: number;
  consecutiveMisses: number;
  score: number;
};

type AdaptivePlatformState = {
  routes: Record<string, AdaptiveRouteState>;
  seeds: Record<string, AdaptiveSeedState>;
};

type AdaptiveConfigFile = {
  updatedAt: string;
  platforms: Partial<Record<GrowthPlatform, AdaptivePlatformState>>;
};

type AdaptiveRouteDefaults = {
  pageCount?: number;
  concurrency?: number;
  keywordLimit?: number;
  enabled?: boolean;
  minimumPages?: number;
};

type AdaptiveRouteDecision = {
  enabled: boolean;
  pageCount?: number;
  concurrency?: number;
  keywordLimit?: number;
  weight: number;
  state?: AdaptiveRouteState;
};

const DEFAULT_STORE_ROOT = path.resolve(process.cwd(), ".cache");
const STORE_DIR = path.resolve(process.env.GROWTH_STORE_DIR || path.join(DEFAULT_STORE_ROOT, "growth"));
const ADAPTIVE_CONFIG_FILE = path.join(STORE_DIR, "adaptive-config.json");

function createEmptyFile(): AdaptiveConfigFile {
  return {
    updatedAt: nowShanghaiIso(),
    platforms: {},
  };
}

async function ensureStoreDir() {
  await fs.mkdir(STORE_DIR, { recursive: true });
}

async function readAdaptiveConfigFile(): Promise<AdaptiveConfigFile> {
  try {
    const raw = await fs.readFile(ADAPTIVE_CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw) as AdaptiveConfigFile;
    return {
      updatedAt: parsed.updatedAt || nowShanghaiIso(),
      platforms: parsed.platforms || {},
    };
  } catch {
    return createEmptyFile();
  }
}

async function writeAdaptiveConfigFile(next: AdaptiveConfigFile) {
  await ensureStoreDir();
  const tempPath = `${ADAPTIVE_CONFIG_FILE}.next`;
  await fs.writeFile(tempPath, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tempPath, ADAPTIVE_CONFIG_FILE);
}

function ensurePlatformState(file: AdaptiveConfigFile, platform: GrowthPlatform) {
  file.platforms[platform] ||= {
    routes: {},
    seeds: {},
  };
  return file.platforms[platform]!;
}

function normalizeSeed(value: string) {
  return String(value || "").trim().toLowerCase();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export async function getAdaptiveRouteDecision(
  platform: GrowthPlatform,
  routeKey: string,
  defaults: AdaptiveRouteDefaults = {},
): Promise<AdaptiveRouteDecision> {
  const file = await readAdaptiveConfigFile();
  const state = file.platforms?.[platform]?.routes?.[routeKey];
  const enabledDefault = defaults.enabled ?? true;
  if (!state) {
    return {
      enabled: enabledDefault,
      pageCount: defaults.pageCount,
      concurrency: defaults.concurrency,
      keywordLimit: defaults.keywordLimit,
      weight: 1,
    };
  }

  let weight = 1;
  if (state.consecutiveHits >= 2) weight += 0.25;
  if (state.consecutiveHits >= 4) weight += 0.35;
  if (state.avgYieldPerRun >= 80) weight += 0.25;
  if (state.avgYieldPerRun >= 200) weight += 0.35;
  if (state.consecutiveMisses >= 2) weight -= 0.25;
  if (state.consecutiveMisses >= 4) weight -= 0.35;
  if (state.avgYieldPerRun <= 3 && state.totalRuns >= 3) weight -= 0.25;
  weight = clamp(weight, 0.35, 2.25);

  const enabled = enabledDefault && !(state.consecutiveMisses >= 6 && state.avgYieldPerRun <= 1);
  const applyScaledInt = (value?: number, minimum = 1) =>
    typeof value === "number" ? Math.max(minimum, Math.round(value * weight)) : undefined;

  return {
    enabled,
    pageCount: applyScaledInt(defaults.pageCount, defaults.minimumPages || 1),
    concurrency: applyScaledInt(defaults.concurrency, 1),
    keywordLimit: applyScaledInt(defaults.keywordLimit, 1),
    weight,
    state,
  };
}

export async function prioritizeAdaptiveSeeds(
  platform: GrowthPlatform,
  routeKey: string,
  seeds: string[],
  limit: number,
) {
  const file = await readAdaptiveConfigFile();
  const platformState = file.platforms?.[platform];
  const deduped = Array.from(new Set(seeds.map((seed) => String(seed || "").trim()).filter(Boolean)));
  const scored = deduped.map((seed, index) => {
    const key = `${routeKey}:${normalizeSeed(seed)}`;
    const state = platformState?.seeds?.[key];
    const baseScore = state?.score ?? 0;
    const bonus = state?.consecutiveHits ? state.consecutiveHits * 0.25 : 0;
    const penalty = state?.consecutiveMisses ? state.consecutiveMisses * 0.2 : 0;
    return {
      seed,
      index,
      score: baseScore + bonus - penalty,
    };
  });
  return scored
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(1, limit))
    .map((item) => item.seed);
}

export async function recordAdaptiveRouteRun(params: {
  platform: GrowthPlatform;
  routeKey: string;
  yieldCount: number;
  requestCount: number;
}) {
  const file = await readAdaptiveConfigFile();
  const platformState = ensurePlatformState(file, params.platform);
  const current = platformState.routes[params.routeKey] || {
    key: params.routeKey,
    lastYieldCount: 0,
    lastRequestCount: 0,
    totalRuns: 0,
    totalYieldCount: 0,
    totalRequestCount: 0,
    consecutiveHits: 0,
    consecutiveMisses: 0,
    avgYieldPerRun: 0,
    avgYieldPerRequest: 0,
  };
  const nextTotalRuns = current.totalRuns + 1;
  const nextTotalYield = current.totalYieldCount + params.yieldCount;
  const nextTotalRequests = current.totalRequestCount + params.requestCount;
  const hit = params.yieldCount > 0;
  platformState.routes[params.routeKey] = {
    ...current,
    lastRunAt: nowShanghaiIso(),
    lastYieldCount: params.yieldCount,
    lastRequestCount: params.requestCount,
    totalRuns: nextTotalRuns,
    totalYieldCount: nextTotalYield,
    totalRequestCount: nextTotalRequests,
    consecutiveHits: hit ? current.consecutiveHits + 1 : 0,
    consecutiveMisses: hit ? 0 : current.consecutiveMisses + 1,
    avgYieldPerRun: nextTotalYield / nextTotalRuns,
    avgYieldPerRequest: nextTotalRequests > 0 ? nextTotalYield / nextTotalRequests : 0,
  };
  file.updatedAt = nowShanghaiIso();
  await writeAdaptiveConfigFile(file);
}

export async function recordAdaptiveSeedRun(params: {
  platform: GrowthPlatform;
  routeKey: string;
  seeds: string[];
  yieldedCount: number;
}) {
  const file = await readAdaptiveConfigFile();
  const platformState = ensurePlatformState(file, params.platform);
  const dedupedSeeds = Array.from(new Set(params.seeds.map((seed) => String(seed || "").trim()).filter(Boolean)));
  if (!dedupedSeeds.length) return;
  const credit = params.yieldedCount > 0 ? params.yieldedCount / dedupedSeeds.length : 0;
  for (const seed of dedupedSeeds) {
    const seedKey = `${params.routeKey}:${normalizeSeed(seed)}`;
    const current = platformState.seeds[seedKey] || {
      key: seedKey,
      totalRuns: 0,
      totalCredit: 0,
      consecutiveHits: 0,
      consecutiveMisses: 0,
      score: 0,
    };
    const hit = credit > 0;
    const nextRuns = current.totalRuns + 1;
    const nextCredit = current.totalCredit + credit;
    platformState.seeds[seedKey] = {
      ...current,
      lastUsedAt: nowShanghaiIso(),
      totalRuns: nextRuns,
      totalCredit: nextCredit,
      consecutiveHits: hit ? current.consecutiveHits + 1 : 0,
      consecutiveMisses: hit ? 0 : current.consecutiveMisses + 1,
      score: (nextCredit / nextRuns) + (hit ? 0.5 : -0.35),
    };
  }
  file.updatedAt = nowShanghaiIso();
  await writeAdaptiveConfigFile(file);
}

