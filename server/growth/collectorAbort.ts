/**
 * Growth 采集取消上下文。
 *
 * 旧 withTimeout 只用 Promise.race：超时后调度器继续下一轮，但抖音/B站抓取
 * 仍在同进程跑，把 2 核机器打满 → Fly 健康检查失败 → 用户成片/上传被掐。
 * 这里用 AbortSignal + AsyncLocalStorage，让超时真正停掉后续 fetch/sleep。
 */

import { AsyncLocalStorage } from "node:async_hooks";

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
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      runWithCollectorAbort(
        controller.signal,
        () => work(controller.signal),
        { deadlineMs: Date.now() + timeoutMs },
      ),
      timeoutPromise,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
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
