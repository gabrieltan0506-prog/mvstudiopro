/**
 * 后期工坊异步任务:worker 对旧任务数据用统一 Schema 再解析一次,
 * 并在执行前重新读取素材登记记录(队列里躺过的任务不吃入队时的旧核对结果);
 * 任务时限用 AbortSignal 贯通到下载与 ffmpeg/ffprobe 子进程,
 * 即使 operation 不读取 signal,等待也会在时限附近结束;不自动重做。
 */
import { concatClips, loudnessCheck, mountBgm } from "../services/postProduction";
import { resolvePostProdInputSources } from "../services/postProdMediaSource";
import { postProdJobInputSchema } from "./postProdInput";

export type PostProdJobOptions = { signal?: AbortSignal };

export async function processPostProdJob(
  rawInput: unknown,
  userId: string,
  options?: PostProdJobOptions,
): Promise<{ output: unknown; provider: string }> {
  const parsed = postProdJobInputSchema.parse(rawInput);
  // worker 执行前重新核对素材登记约束(与入队同一把尺)
  const input = await resolvePostProdInputSources({ userId, input: parsed });
  const runOptions = { signal: options?.signal };
  switch (input.action) {
    case "concat": {
      const output = await concatClips(input.params, userId, runOptions);
      return { output, provider: "ffmpeg-post-prod" };
    }
    case "bgm_mount": {
      const output = await mountBgm(input.params, userId, runOptions);
      return { output, provider: "ffmpeg-post-prod" };
    }
    case "loudness_check": {
      const output = await loudnessCheck(input.params, runOptions);
      return { output, provider: "ffmpeg-post-prod" };
    }
  }
}

/**
 * 任务时限执行器:时限到 abort(),让下载与媒体子进程同步结束;
 * 同时用 abort 事件参与等待竞速——不读取 signal 的 operation 也会按时限结束等待。
 * 只结束本次处理,不在这里重排任务(runner 侧直接判失败)。
 */
export async function runWithTaskLimit<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
  externalSignal?: AbortSignal,
): Promise<T> {
  const timeoutController = new AbortController();
  const timeoutReason = new DOMException(
    `post_prod job timed out after ${timeoutMs}ms`,
    "AbortError",
  );
  const timer = setTimeout(() => {
    timeoutController.abort(timeoutReason);
  }, timeoutMs);

  const signal = externalSignal
    ? AbortSignal.any([timeoutController.signal, externalSignal])
    : timeoutController.signal;

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(signal.reason ?? new DOMException("post_prod job stopped", "AbortError"));
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });

  try {
    const operationPromise = Promise.resolve().then(() => operation(signal));
    // 时限先到时 race 已 reject;operation 之后的拒绝不许变成 unhandled rejection
    operationPromise.catch(() => {});
    return await Promise.race([operationPromise, aborted]);
  } finally {
    clearTimeout(timer);
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

export async function runPostProdJobWithLimit(
  rawInput: unknown,
  userId: string,
  timeoutMs: number,
): Promise<{ output: unknown; provider: string }> {
  return runWithTaskLimit(timeoutMs, (signal) => processPostProdJob(rawInput, userId, { signal }));
}
