/**
 * Growth 采集取消上下文。
 *
 * 旧 withTimeout 只用 Promise.race：超时后调度器继续下一轮，但抖音/B站抓取
 * 仍在同进程跑，把 2 核机器打满 → Fly 健康检查失败 → 用户成片/上传被掐。
 * 这里用 AbortSignal + AsyncLocalStorage，让超时真正停掉后续 fetch/sleep。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { GROWTH_BACKGROUND_PAUSED_FOR_INTERACTIVE_WORKLOAD } from "./growthWorkloadPriority";

type CollectorAbortContext = {
  signal: AbortSignal;
  deadlineMs?: number;
};

const storage = new AsyncLocalStorage<CollectorAbortContext>();

export function getCollectorAbortSignal(): AbortSignal | undefined {
  return storage.getStore()?.signal;
}

export function getCollectorTimeRemainingMs(nowMs = Date.now()): number | undefined {
  const deadlineMs = storage.getStore()?.deadlineMs;
  return typeof deadlineMs === "number"
    ? Math.max(0, deadlineMs - nowMs)
    : undefined;
}

export function assertCollectorNotAborted(): void {
  const signal = getCollectorAbortSignal();
  if (signal?.aborted) {
    throw new Error("growth_collector_aborted");
  }
}

export async function runWithCollectorAbort<T>(
  signal: AbortSignal,
  work: () => Promise<T>,
  options?: { deadlineMs?: number },
): Promise<T> {
  return storage.run({ signal, deadlineMs: options?.deadlineMs }, work);
}

/**
 * 公共采集入口传入显式 signal 时也接入 ALS；若外层已有调度器 signal，则合并两者
 * 并保留原 deadline，避免只有 scheduler/backfill 内部调用才能真正中止 fetch。
 */
export async function runWithOptionalCollectorAbortSignal<T>(
  signal: AbortSignal | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const contextualSignal = getCollectorAbortSignal();
  if (!signal || signal === contextualSignal) return work();
  const merged = mergeAbortSignals(contextualSignal, signal) || signal;
  const remainingMs = getCollectorTimeRemainingMs();
  return runWithCollectorAbort(merged, work, {
    deadlineMs: remainingMs === undefined ? undefined : Date.now() + remainingMs,
  });
}

export function mergeAbortSignals(
  ...signals: Array<AbortSignal | undefined | null>
): AbortSignal | undefined {
  const list = signals.filter((value): value is AbortSignal => Boolean(value));
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];
  const controller = new AbortController();
  for (const signal of list) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener(
      "abort",
      () => {
        if (!controller.signal.aborted) controller.abort(signal.reason);
      },
      { once: true },
    );
  }
  return controller.signal;
}

/**
 * 跑带超时的采集：超时立刻 abort signal，避免孤儿抓取继续占满事件循环。
 */
export async function withAbortableTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
  options?: {
    signal?: AbortSignal;
    abortWhen?: () => boolean | Promise<boolean>;
    abortPollMs?: number;
  },
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abortPollTimer: ReturnType<typeof setInterval> | null = null;
  let removeExternalAbortListener: (() => void) | null = null;
  let rejectPriorityAbort: ((error: Error) => void) | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  const externalAbortPromise = new Promise<never>((_, reject) => {
    const external = options?.signal;
    if (!external) return;
    const abort = () => {
      if (!controller.signal.aborted) controller.abort(external.reason);
      reject(new Error("growth_collector_aborted"));
    };
    if (external.aborted) {
      abort();
      return;
    }
    external.addEventListener("abort", abort, { once: true });
    removeExternalAbortListener = () => external.removeEventListener("abort", abort);
  });
  const priorityAbortPromise = new Promise<never>((_, reject) => {
    if (!options?.abortWhen) return;
    rejectPriorityAbort = reject;
  });
  if (options?.abortWhen) {
    let checking = false;
    const checkPriority = () => {
      if (checking || controller.signal.aborted) return;
      checking = true;
      void Promise.resolve()
        .then(() => options.abortWhen?.())
        .then((shouldAbort) => {
          if (!shouldAbort || controller.signal.aborted) return;
          rejectPriorityAbort?.(new Error(GROWTH_BACKGROUND_PAUSED_FOR_INTERACTIVE_WORKLOAD));
          controller.abort("growth_interactive_workload_started");
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          console.warn("[growth.priority] 前台租约探针失败，安全暂停后台工作", error);
          rejectPriorityAbort?.(new Error(
            `${GROWTH_BACKGROUND_PAUSED_FOR_INTERACTIVE_WORKLOAD}:priority_probe_failed`,
          ));
          controller.abort("growth_interactive_workload_probe_failed");
        })
        .finally(() => {
          checking = false;
        });
    };
    checkPriority();
    abortPollTimer = setInterval(checkPriority, Math.max(250, options.abortPollMs || 1_000));
  }
  try {
    return await Promise.race([
      runWithCollectorAbort(
        controller.signal,
        () => work(controller.signal),
        { deadlineMs: Date.now() + timeoutMs },
      ),
      timeoutPromise,
      externalAbortPromise,
      priorityAbortPromise,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortPollTimer) clearInterval(abortPollTimer);
    const cleanupExternalAbort = removeExternalAbortListener as (() => void) | null;
    cleanupExternalAbort?.();
    if (!controller.signal.aborted) controller.abort();
  }
}

export function isCollectorAbortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /growth_collector_aborted|aborted|AbortError/i.test(message);
}

/** 调度超时 / 主动 abort：需要进入冷却，不能立刻再抓。 */
export function isSchedulerTimeoutOrAbortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    /timed out after \d+ms/i.test(message) ||
    isCollectorAbortError(error)
  );
}

/**
 * 超时后固定冷却 10 分钟。仍先 abort 当前采集，避免孤儿请求继续占用机器；
 * 但不再因连续超时把正式 burst 逐级锁死 45 分钟、2 小时甚至 4 小时。
 */
export function buildTimeoutCooldownMs(_timeoutStreak: number): number {
  return 10 * 60 * 1000;
}

export function formatTimeoutCooldownLabel(cooldownMs: number): string {
  const minutes = Math.max(1, Math.round(cooldownMs / 60_000));
  if (minutes >= 60 && minutes % 60 === 0) {
    return `超时冷却中，${minutes / 60} 小时后重试`;
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `超时冷却中，${hours} 小时 ${rest} 分钟后重试`;
  }
  return `超时冷却中，${minutes} 分钟后重试`;
}
