import { AsyncLocalStorage } from "node:async_hooks";
import { readFile, statfs } from "node:fs/promises";
import { availableParallelism, freemem, tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { beginGrowthInteractiveWorkload } from "../growth/growthWorkloadPriority";
import { withGrowthStoreMutationLock } from "../growth/growthStoreMutationLock";
import { withGrowthCollectionExclusive } from "../growth/platformCollectionLane";

const MiB = 1024 * 1024;
const MIN_AVAILABLE_BYTES = 3 * 1024 * MiB;
/** 持有 growth 锁时最多为内存复核等待的时长；超出即释放锁，避免空等卡死采集。 */
const LOCKED_MEMORY_WAIT_MS = 60_000;
class PostProdMemoryNotReady extends Error {
  constructor() { super("post_prod_memory_not_ready_under_growth_lock"); }
}
export type MediaRuntime = { phase: string; childPid?: number };
export const mediaRuntime = new AsyncLocalStorage<MediaRuntime>();

/** 解码器、滤镜、编码器分别限线程；不改分辨率、帧率、CRF 或音轨。 */
export function boundMediaThreads(args: string[], count = Math.min(2, availableParallelism())) {
  const n = String(Math.max(1, Math.floor(count)));
  const result = ["-filter_threads", n, "-filter_complex_threads", n];
  for (const arg of args) {
    if (arg === "-i") result.push("-threads", n);
    result.push(arg);
  }
  // 输出选项必须在最后一个输出文件之前；各后期命令仅有一个输出。
  result.splice(result.length - 1, 0, "-threads", n);
  return result;
}

export async function readResourceSnapshot(state?: MediaRuntime) {
  const usage = process.memoryUsage();
  let availableBytes = freemem();
  try {
    const info = await readFile("/proc/meminfo", "utf8");
    const value = info.match(/^MemAvailable:\s+(\d+)/m);
    if (value) availableBytes = Number(value[1]) * 1024;
    // 容器内以更小的 cgroup 余额为准；Fly VM 没有限额时使用整机可用内存。
    const [used, max] = await Promise.all([
      readFile("/sys/fs/cgroup/memory.current", "utf8"), readFile("/sys/fs/cgroup/memory.max", "utf8"),
    ]).catch(() => Promise.all([
      readFile("/sys/fs/cgroup/memory/memory.usage_in_bytes", "utf8"),
      readFile("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf8"),
    ]).catch(() => ["", "max"]));
    if (/^\d+$/.test(max.trim())) availableBytes = Math.min(availableBytes, Number(max) - Number(used));
  } catch (error) {
    if (process.platform === "linux") throw error; // Linux 无法读取预算时不可冒险开工。
  }
  let childRssBytes: number | null = null;
  if (state?.childPid) {
    const status = await readFile(`/proc/${state.childPid}/status`, "utf8").catch(() => "");
    const rss = status.match(/^VmRSS:\s+(\d+)/m);
    if (rss) childRssBytes = Number(rss[1]) * 1024;
  }
  return { sampledAt: new Date().toISOString(), phase: state?.phase ?? "waiting_resources",
    availableBytes, rssBytes: usage.rss, heapUsedBytes: usage.heapUsed,
    externalBytes: usage.external, arrayBufferBytes: usage.arrayBuffers,
    childPid: state?.childPid ?? null, childRssBytes };
}

// 所有后期通道共用一条本机通道，避免视频编码与三条 BGM 渲染同时占满内存。
let exclusiveTail: Promise<void> = Promise.resolve();
const learningRuns = new Set<Promise<void>>();
let activeResources = 0;
export function postProdResourcesBusy() { return activeResources > 0; }
export async function waitForPostProdResources() { await Promise.all([exclusiveTail, ...Array.from(learningRuns)]); }
export async function withPostProdResources<T>(
  jobId: string, signal: AbortSignal, state: MediaRuntime, work: (signal: AbortSignal) => Promise<T>,
  options: { parallelLearning?: boolean } = {},
): Promise<T> {
  const parallelLearning = options.parallelLearning === true;
  if (parallelLearning && process.env.JOB_WORKER_ROLE !== "rig") throw new Error("并发媒体学习仅允许在工作机运行");
  activeResources++;
  const previous = parallelLearning ? exclusiveTail : Promise.all([exclusiveTail, ...Array.from(learningRuns)]);
  let release!: () => void;
  const owned = new Promise<void>(resolve => { release = resolve; });
  if (parallelLearning) learningRuns.add(owned);
  else exclusiveTail = owned;
  // 被取消的等待者也须等前任释放再交接，不能让后续任务穿透互斥。
  await previous;
  let releasePriority: (() => Promise<void>) | undefined;
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  let monitor: ReturnType<typeof setInterval> | undefined;
  let sampling = false;
  try {
    combined.throwIfAborted();
    // 前台优先租约会让后台采集让路：工作机照旧开工即取；网站机改到「内存已足够」之后再取，
    // 否则一个等不到内存的后期任务会靠心跳一直续着租约，采集被无限期让路（1114 独立审查发现）。
    const takePriority = async () => { releasePriority ??= await beginGrowthInteractiveWorkload(`post_prod:${jobId}`); };
    const dropPriority = async () => {
      const held = releasePriority; releasePriority = undefined;
      try { await held?.(); } catch { console.warn("[post-prod] priority lease cleanup deferred"); }
    };
    if (process.env.JOB_WORKER_ROLE === "rig") await takePriority();
    const memoryReady = async () => (await readResourceSnapshot(state)).availableBytes >= MIN_AVAILABLE_BYTES;
    /** 等内存；limitMs 未给时不设上限（只在未持有任何 growth 锁时使用）。 */
    const waitForMemory = async (limitMs?: number) => {
      state.phase = "waiting_memory";
      const startedAt = Date.now();
      while (!(await memoryReady())) {
        if (limitMs !== undefined && Date.now() - startedAt >= limitMs) return false;
        await delay(5_000, undefined, { signal: combined });
      }
      return true;
    };
    const execute = async (lockedMemoryWaitMs?: number) => {
      if (!(await waitForMemory(lockedMemoryWaitMs))) throw new PostProdMemoryNotReady();
      combined.throwIfAborted();
      const disk = await statfs(tmpdir());
      if (Number(disk.bavail) * Number(disk.bsize) < 2560 * MiB) {
        throw new Error("后期临时盘可用空间不足 2.5GiB，未开始媒体处理，原素材保留");
      }
      monitor = setInterval(() => {
        if (sampling) return;
        sampling = true;
        void readResourceSnapshot(state).then(snapshot => {
          if (snapshot.availableBytes < 256 * MiB) {
            controller.abort(new Error("整机可用内存低于 256MiB，已停止本任务以保留服务及原素材；请核对资源记录"));
          }
        }).catch(error => controller.abort(error)).finally(() => { sampling = false; });
      }, 5_000);
      monitor.unref?.();
      return mediaRuntime.run(state, () => work(combined));
    };
    if (process.env.JOB_WORKER_ROLE === "rig") return await execute();
    // 网站机：内存不足时绝不持有 growth 采集/存储锁空等（否则采集与存储写入会被无限期卡死）。
    // 先在锁外等到内存足够；拿锁后只给一段有界的复核时间，仍不足就释放锁回到锁外继续等。
    while (true) {
      await waitForMemory();
      combined.throwIfAborted();
      await takePriority();
      state.phase = "waiting_growth";
      try {
        return await withGrowthCollectionExclusive(combined,
          () => controller.abort(new Error("后期资源互斥租约续期失败，已停止本任务")),
          () => withGrowthStoreMutationLock("post-prod", () => execute(LOCKED_MEMORY_WAIT_MS), { signal: combined, waitUntilReleased: true,
            onLeaseLost: () => controller.abort(new Error("后期存储互斥租约续期失败，已停止本任务")) }));
      } catch (error) {
        if (!(error instanceof PostProdMemoryNotReady)) throw error;
        // 回到锁外等内存期间不占前台优先租约，让后台采集照常进行。
        await dropPriority();
        console.warn(`[post-prod] ${jobId} 持锁复核内存仍不足，已释放 growth 锁并在锁外继续等待`);
      }
    }
  } finally {
    if (monitor) clearInterval(monitor);
    try { await releasePriority?.(); } catch { console.warn("[post-prod] priority lease cleanup deferred"); } finally { activeResources--; learningRuns.delete(owned); release(); }
  }
}
