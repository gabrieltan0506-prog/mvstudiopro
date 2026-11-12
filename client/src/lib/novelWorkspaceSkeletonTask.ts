/**
 * 爆款仿写 · 底稿结构拆解的前台轮询（1112）：发起后台任务 → 每 3 秒查一次进度 → 完成后返回结果。
 * - 单次查询失败不算拆解失败；连续 NOVEL_SKELETON_POLL_MAX_ERRORS 次查询失败才放弃。
 * - 任务查不到（missing，例如服务重启）时用同一底稿重新发起（已完成的片服务端有缓存，不重做），最多 NOVEL_SKELETON_MAX_RESTARTS 次。
 * - 任务失败时抛出服务端给的中性提示。
 */
export const NOVEL_SKELETON_POLL_MS = 3000;
export const NOVEL_SKELETON_POLL_MAX_ERRORS = 5;
export const NOVEL_SKELETON_MAX_RESTARTS = 3;

export type NovelSkeletonTaskView<R> =
  | { status: "running"; taskId: string; done: number; total: number }
  | { status: "succeeded"; taskId: string; done: number; total: number; result: R }
  | { status: "failed"; taskId: string; error: string }
  | { status: "missing"; taskId: string };

export class NovelSkeletonTaskError extends Error {
  constructor(
    message: string,
    readonly kind: "failed" | "poll" | "missing"
  ) {
    super(message);
    this.name = "NovelSkeletonTaskError";
  }
}

export async function runNovelSkeletonTask<R>(deps: {
  /** 发起（或复用）任务；每次调用都应带新的请求号。 */
  start: () => Promise<NovelSkeletonTaskView<R>>;
  status: (taskId: string) => Promise<NovelSkeletonTaskView<R>>;
  onProgress?: (progress: { done: number; total: number }) => void;
  sleep?: (ms: number) => Promise<void>;
  /** 返回 false 时停止轮询（例如页面已卸载）。 */
  alive?: () => boolean;
  /** 放弃时的提示（沿用现有中性文案）。 */
  failedMessage: string;
}): Promise<R | undefined> {
  const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const alive = deps.alive ?? (() => true);
  let restarts = 0;
  let view = await deps.start();
  let errors = 0;
  for (;;) {
    if (view.status === "succeeded") {
      deps.onProgress?.({ done: view.done, total: view.total });
      return view.result;
    }
    if (view.status === "failed") throw new NovelSkeletonTaskError(view.error || deps.failedMessage, "failed");
    if (view.status === "missing") {
      if (restarts >= NOVEL_SKELETON_MAX_RESTARTS) throw new NovelSkeletonTaskError(deps.failedMessage, "missing");
      restarts += 1;
      view = await deps.start();
      continue;
    }
    deps.onProgress?.({ done: view.done, total: view.total });
    await sleep(NOVEL_SKELETON_POLL_MS);
    if (!alive()) return undefined;
    const taskId = view.taskId;
    try {
      view = await deps.status(taskId);
      errors = 0;
    } catch {
      errors += 1;
      if (errors >= NOVEL_SKELETON_POLL_MAX_ERRORS) throw new NovelSkeletonTaskError(deps.failedMessage, "poll");
    }
  }
}
