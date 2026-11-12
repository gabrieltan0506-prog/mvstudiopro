/**
 * 爆款仿写 · 底稿结构拆解改为「发起即返回任务标识、后台执行、前台轮询」（1112，照 knowledgeCardPdfExportTasks 的模式）。
 *
 * 长底稿分片多，同步请求容易超过网关等待上限：前台看到失败，服务端其实还在拆。
 *
 * 语义：
 * - 任务键 = 账号 | 底稿 sha256 | 线路；同键重复发起复用进行中 / 已完成的任务（刷新或重复点击不重复拆解）。失败的任务不复用，重新发起即重跑
 *   （已完成的片在 resolveNovelImitationSkeleton 里有分片缓存，不重做）。
 * - 进度：done / total 片，来自 resolveNovelImitationSkeleton 的 onShard 回调；分片数未知前 total = 0。
 * - 只在进程内存放任务状态；查询时校验账号，绝不返回他人任务；未知（含进程重启后）由前台用同一底稿重新发起。
 * - 拆解本身、收录、失败语义、缓存与证据都沿用 runNovelImitationSkeleton，不在这里改。
 */
import { createHash } from "node:crypto";
import type { NovelImitationLibraryOutcome, NovelImitationSkeleton } from "../../shared/novelImitation";
import type { NovelTestInput } from "../../shared/novelWorkspace";

export type NovelImitationSkeletonTaskResult = { skeleton: NovelImitationSkeleton; library: NovelImitationLibraryOutcome };

export type NovelImitationSkeletonTaskState =
  | { status: "running"; taskId: string; startedAt: number; done: number; total: number }
  | { status: "succeeded"; taskId: string; startedAt: number; finishedAt: number; done: number; total: number; result: NovelImitationSkeletonTaskResult }
  | { status: "failed"; taskId: string; startedAt: number; finishedAt: number; error: string };

export type NovelImitationSkeletonTaskInput = {
  requestId: string;
  baseText: string;
  baseTitle?: string;
  modelPreference?: NovelTestInput["modelPreference"];
};

type Task = { owner: number; state: NovelImitationSkeletonTaskState; promise: Promise<void> };
type Deps = {
  run: (params: {
    userId: number;
    role?: string | null;
    input: NovelImitationSkeletonTaskInput;
    onShard: (progress: { done: number; total: number }) => void;
  }) => Promise<NovelImitationSkeletonTaskResult>;
  now?: () => number;
};

const KEEP_FINISHED_MS = 30 * 60_000;
const MAX_TASKS = 200;
/** 与 runNovelImitationSkeleton 的兜底提示一致（中性、可重试）。 */
export const NOVEL_IMITATION_SKELETON_TASK_FALLBACK_ERROR = "底稿结构整理暂不可用，底稿与已填内容保留；可稍后重新提交。";

/** 任务键：账号 + 底稿内容摘要 + 线路（缺省线路按 auto 计，与拆解缓存同口径）。 */
export function novelImitationSkeletonTaskKey(owner: number, baseText: string, modelPreference?: string): string {
  const baseSha256 = createHash("sha256").update(baseText).digest("hex");
  return createHash("sha256").update(`${owner}|${baseSha256}|${modelPreference ?? "auto"}`).digest("hex").slice(0, 32);
}

export function createNovelImitationSkeletonTasks(deps: Deps) {
  const tasks = new Map<string, Task>();
  const now = deps.now ?? Date.now;
  const prune = () => {
    for (const [id, task] of Array.from(tasks.entries()))
      if (task.state.status !== "running" && now() - task.state.finishedAt > KEEP_FINISHED_MS) tasks.delete(id);
    while (tasks.size > MAX_TASKS) {
      const oldest = Array.from(tasks.entries()).find(([, t]) => t.state.status !== "running");
      if (!oldest) break;
      tasks.delete(oldest[0]);
    }
  };
  return {
    /** role：1112 计费用（管理者跳过预检、0 扣）；预检与扣费都在 run（runNovelImitationSkeleton）里。 */
    start(owner: number, input: NovelImitationSkeletonTaskInput, role?: string | null): NovelImitationSkeletonTaskState {
      prune();
      const taskId = novelImitationSkeletonTaskKey(owner, input.baseText, input.modelPreference);
      const prior = tasks.get(taskId);
      if (prior && prior.owner === owner && prior.state.status !== "failed") return prior.state;
      const startedAt = now();
      const task: Task = {
        owner,
        state: { status: "running", taskId, startedAt, done: 0, total: 0 },
        promise: Promise.resolve(),
      };
      // 先登记再启动：run 同步回调进度时也能找到任务。
      tasks.set(taskId, task);
      let progress = { done: 0, total: 0 };
      task.promise = Promise.resolve()
        .then(() =>
          deps.run({
            userId: owner,
            role,
            input,
            onShard: p => {
              progress = { done: Math.max(0, Math.min(p.done, p.total)), total: Math.max(0, p.total) };
              if (task.state.status === "running") task.state = { ...task.state, ...progress };
            },
          })
        )
        .then(
          result => {
            const total = progress.total || 1;
            task.state = { status: "succeeded", taskId, startedAt, finishedAt: now(), done: total, total, result };
            console.log(`[novel-imitation-skeleton-task] ok shards=${progress.total} ms=${now() - startedAt}`);
          },
          error => {
            const message =
              (error instanceof Error && error.message ? error.message : "").slice(0, 200) || NOVEL_IMITATION_SKELETON_TASK_FALLBACK_ERROR;
            console.warn(`[novel-imitation-skeleton-task] failed ms=${now() - startedAt}`);
            task.state = { status: "failed", taskId, startedAt, finishedAt: now(), error: message };
          }
        );
      return task.state;
    },
    /** 查询只返回本人任务；未知（含进程重启后）返回 null，由前台用同一底稿重新发起。 */
    status(owner: number, taskId: string): NovelImitationSkeletonTaskState | null {
      const task = tasks.get(taskId);
      if (!task || task.owner !== owner) return null;
      return task.state;
    },
    /** 测试用：等待任务结束。 */
    async settled(taskId: string) {
      await tasks.get(taskId)?.promise;
    },
  };
}

let shared: ReturnType<typeof createNovelImitationSkeletonTasks> | undefined;
export function novelImitationSkeletonTasks() {
  shared ??= createNovelImitationSkeletonTasks({
    run: async ({ userId, role, input, onShard }) => {
      const { runNovelImitationSkeleton } = await import("./novelWorkspaceTest");
      const { resolveNovelImitationSkeleton } = await import("./novelImitationSkeleton");
      return runNovelImitationSkeleton(userId, input, {
        role,
        resolve: params => resolveNovelImitationSkeleton({ ...params, onShard }),
      });
    },
  });
  return shared;
}
