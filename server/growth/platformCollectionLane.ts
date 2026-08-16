import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { GrowthPlatform } from "@shared/growth";
import {
  GROWTH_BACKGROUND_DEFERRED_BEFORE_COLLECTION_START,
  hasActiveGrowthInteractiveWorkload,
  isGrowthCollectionDeferredBeforeStartError,
} from "./growthWorkloadPriority";

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

type GapPriorityGateOptions = {
  remainingMs: number;
  hasActiveWorkload?: () => boolean | Promise<boolean>;
  sleep?: (delayMs: number) => Promise<void>;
};

/**
 * 持有跨进程锁后，间隔等待的前后都检查前台任务。前台可能恰好在 3–5 分钟
 * 等待期间开始；若不复检，后台会在用户任务运行中直接启动真实网络采集。
 */
export async function waitForGrowthCollectionGapOrDefer(
  options: GapPriorityGateOptions,
) {
  const hasActiveWorkload = options.hasActiveWorkload || hasActiveGrowthInteractiveWorkload;
  const sleep = options.sleep || delay;
  const foregroundIsActive = async () => {
    try {
      return await hasActiveWorkload();
    } catch (error) {
      console.warn("[growth.collection-lane] 前台租约状态无法确认，安全暂停后台采集", error);
      throw new Error(
        `${GROWTH_BACKGROUND_DEFERRED_BEFORE_COLLECTION_START}:priority_probe_failed`,
      );
    }
  };
  if (await foregroundIsActive()) return false;
  if (options.remainingMs > 0) await sleep(options.remainingMs);
  return !(await foregroundIsActive());
}

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
    let shouldRecordFinishedAt = true;
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
    } catch (error) {
      // 跨进程门禁在真正 work 开始前为前台让路，不应把这次“未开工”写成
      // 一次完成，否则每次前台任务都会凭空制造新的 3–5 分钟冷却并可能饥饿。
      if (isGrowthCollectionDeferredBeforeStartError(error)) {
        shouldRecordFinishedAt = false;
      }
      throw error;
    } finally {
      if (shouldRecordFinishedAt) lastFinishedAtMs = now();
      release();
    }
  };
}

const runInProcessCollectionLane = createGrowthPlatformCollectionLane();
const CROSS_PROCESS_LOCK_STALE_MS = 15 * 60 * 1000;
const CROSS_PROCESS_LOCK_WAIT_MS = 30 * 60 * 1000;

function getCrossProcessFiles() {
  const root = path.resolve(
    process.env.GROWTH_STORE_DIR || path.join(process.cwd(), ".cache", "growth"),
  );
  return {
    root,
    lock: path.join(root, ".growth-platform-collection.lock"),
    state: path.join(root, ".growth-platform-collection-state.json"),
  };
}

async function delay(delayMs: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

async function runWithCrossProcessCollectionLease<T>(
  platform: GrowthPlatform,
  source: GrowthCollectionSource,
  work: () => Promise<T>,
) {
  const files = getCrossProcessFiles();
  const token = `${process.pid}:${randomUUID()}`;
  const startedWaitingAt = Date.now();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let workStarted = false;
  await fs.mkdir(files.root, { recursive: true });

  while (true) {
    try {
      const handle = await fs.open(files.lock, "wx");
      await handle.writeFile(JSON.stringify({
        token,
        pid: process.pid,
        platform,
        source,
        acquiredAt: new Date().toISOString(),
      }));
      await handle.close();
      heartbeat = setInterval(() => {
        const now = new Date();
        void fs.utimes(files.lock, now, now).catch(() => {});
      }, 30_000);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stat = await fs.stat(files.lock).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > CROSS_PROCESS_LOCK_STALE_MS) {
        await fs.unlink(files.lock).catch(() => {});
        continue;
      }
      if (Date.now() - startedWaitingAt >= CROSS_PROCESS_LOCK_WAIT_MS) {
        throw new Error(`growth_platform_collection_lock_timeout:${platform}:${source}`);
      }
      await delay(500);
    }
  }

  try {
    let persisted: { lastFinishedAtMs?: number } = {};
    try {
      persisted = JSON.parse(await fs.readFile(files.state, "utf8")) as { lastFinishedAtMs?: number };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // 无法证明上一轮结束时间时不能按 0 处理并立即开抓，否则跨进程 3–5 分钟
        // 间隔会在卷 I/O/权限异常时静默失效。释放 lease，交给下一轮重试。
        throw new Error(
          `${GROWTH_BACKGROUND_DEFERRED_BEFORE_COLLECTION_START}:collection_state_read_failed`,
        );
      }
    }
    const gapMs = resolveGrowthPlatformCollectionGapMs();
    const remainingMs = Math.max(0, gapMs - (Date.now() - Number(persisted.lastFinishedAtMs || 0)));
    if (remainingMs > 0) {
      console.info(
        `[growth.collection-lane] ${platform}/${source} 跨进程等待 ${Math.ceil(remainingMs / 1000)} 秒。`,
      );
    }
    const ready = await waitForGrowthCollectionGapOrDefer({ remainingMs });
    if (!ready) {
      throw new Error(GROWTH_BACKGROUND_DEFERRED_BEFORE_COLLECTION_START);
    }
    workStarted = true;
    return await work();
  } finally {
    if (workStarted) {
      const lastFinishedAtMs = Date.now();
      const temp = `${files.state}.${process.pid}.${Date.now()}.next`;
      try {
        await fs.writeFile(temp, JSON.stringify({
          version: 1,
          lastFinishedAtMs,
          lastFinishedAt: new Date(lastFinishedAtMs).toISOString(),
          platform,
          source,
        }), "utf8");
        await fs.rename(temp, files.state);
      } catch (error) {
        console.warn("[growth.collection-lane] 无法持久化跨进程间隔状态", error);
      }
    }
    if (heartbeat) clearInterval(heartbeat);
    const owner = await fs.readFile(files.lock, "utf8").catch(() => "");
    if (owner.includes(token)) await fs.unlink(files.lock).catch(() => {});
  }
}

export function runInGrowthPlatformCollectionLane<T>(
  platform: GrowthPlatform,
  source: GrowthCollectionSource,
  work: () => Promise<T>,
): Promise<T> {
  return runInProcessCollectionLane(
    platform,
    source,
    () => runWithCrossProcessCollectionLease(platform, source, work),
  );
}
