import type { GrowthPlatform } from "@shared/growth";

const MIN_COLLECTION_GAP_MS = 3 * 60 * 1000;
const MAX_COLLECTION_GAP_MS = 5 * 60 * 1000;
const DEFAULT_COLLECTION_GAP_MS = 4 * 60 * 1000;

export type GrowthCollectionSource = "scheduler" | "burst" | "live" | "backfill";

export function resolveGrowthPlatformCollectionGapMs(raw = process.env.GROWTH_PLATFORM_COLLECTION_GAP_MS) {
  const configured = Number(raw || DEFAULT_COLLECTION_GAP_MS);
  if (!Number.isFinite(configured)) return DEFAULT_COLLECTION_GAP_MS;
  return Math.max(MIN_COLLECTION_GAP_MS, Math.min(MAX_COLLECTION_GAP_MS, configured));
}

type LaneOptions = {
  gapMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
};

export function createGrowthPlatformCollectionLane(options: LaneOptions = {}) {
  const now = options.now || Date.now;
  const sleep = options.sleep || ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const gapMs = Math.max(
    MIN_COLLECTION_GAP_MS,
    Math.min(MAX_COLLECTION_GAP_MS, options.gapMs ?? resolveGrowthPlatformCollectionGapMs()),
  );
  let tail: Promise<void> = Promise.resolve();
  let lastFinishedAtMs = 0;

  return async function runInGrowthPlatformCollectionLane<T>(
    platform: GrowthPlatform,
    source: GrowthCollectionSource,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      if (lastFinishedAtMs > 0) {
        const remainingMs = Math.max(0, gapMs - (now() - lastFinishedAtMs));
        if (remainingMs > 0) {
          console.info(
            `[growth.collection-lane] ${platform}/${source} 等待 ${Math.ceil(remainingMs / 1000)} 秒；三平台全模式串行。`,
          );
          await sleep(remainingMs);
        }
      }
      console.info(`[growth.collection-lane] ${platform}/${source} 开始。`);
      return await work();
    } finally {
      lastFinishedAtMs = now();
      release();
    }
  };
}

export const runInGrowthPlatformCollectionLane = createGrowthPlatformCollectionLane();

