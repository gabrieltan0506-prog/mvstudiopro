import fs from "node:fs/promises";
import path from "node:path";
import type { GrowthPlatform } from "@shared/growth";
import type { PlatformTrendCollection } from "./trendCollector";

type TrendStoreFile = {
  updatedAt: string;
  collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>;
};

const STORE_DIR = path.resolve(process.cwd(), ".cache");
const STORE_FILE = path.join(STORE_DIR, "growth-trends.json");

async function ensureStoreDir() {
  await fs.mkdir(STORE_DIR, { recursive: true });
}

export async function readTrendStore(): Promise<TrendStoreFile> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as TrendStoreFile;
    return {
      updatedAt: parsed.updatedAt || new Date(0).toISOString(),
      collections: parsed.collections || {},
    };
  } catch {
    return {
      updatedAt: new Date(0).toISOString(),
      collections: {},
    };
  }
}

export async function writeTrendStore(collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>) {
  await ensureStoreDir();
  const next: TrendStoreFile = {
    updatedAt: new Date().toISOString(),
    collections,
  };
  await fs.writeFile(STORE_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function mergeTrendCollections(collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>) {
  const current = await readTrendStore();
  return writeTrendStore({
    ...current.collections,
    ...collections,
  });
}

export function isTrendCollectionStale(collectedAt?: string, maxAgeHours = 6) {
  if (!collectedAt) return true;
  const timestamp = new Date(collectedAt).getTime();
  if (!Number.isFinite(timestamp)) return true;
  return Date.now() - timestamp > maxAgeHours * 60 * 60 * 1000;
}
