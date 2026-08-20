/**
 * 后期工坊异步任务:worker 对旧任务数据用统一 Schema 再解析一次,
 * 解析通过才分派到 postProduction 三件套;任务时限用 AbortSignal 贯通到
 * 下载与 ffmpeg/ffprobe 子进程,时限到直接结束本次处理,不自动重做。
 */
import { concatClips, loudnessCheck, mountBgm } from "../services/postProduction";
import { postProdJobInputSchema } from "./postProdInput";

export type PostProdJobOptions = { signal?: AbortSignal };

export async function processPostProdJob(
  rawInput: unknown,
  userId: string,
  options?: PostProdJobOptions,
): Promise<{ output: unknown; provider: string }> {
  const input = postProdJobInputSchema.parse(rawInput);
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
 * 任务时限执行器:时限到 abort(),让下载与媒体子进程同步结束。
 * 只结束本次处理,不在这里重排任务(runner 侧直接判失败)。
 */
export async function runWithTaskLimit<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`post_prod job timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function runPostProdJobWithLimit(
  rawInput: unknown,
  userId: string,
  timeoutMs: number,
): Promise<{ output: unknown; provider: string }> {
  return runWithTaskLimit(timeoutMs, (signal) => processPostProdJob(rawInput, userId, { signal }));
}
