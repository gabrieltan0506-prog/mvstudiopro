/**
 * 后期工坊异步任务:worker 对旧任务数据用统一 Schema 再解析一次,
 * 并在执行前重新读取素材登记记录(队列里躺过的任务不吃入队时的旧核对结果);
 * 任务时限用 AbortSignal 贯通到下载与 ffmpeg/ffprobe 子进程,
 * 即使 operation 不读取 signal,等待也会在时限附近结束;不自动重做。
 */
import { burnSubtitle, concatClips, extractAudio, loudnessCheck, mountBgm, trimAudio, renderAudioTimeline } from "../services/postProduction";
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
    case "manhua_auto_rig": {
      const {renderManhuaAutoRig}=await import("../services/manhuaAutoRigRender");
      const output=await renderManhuaAutoRig(input.params,userId,{signal:options?.signal??AbortSignal.timeout(resolvePostProdJobTimeoutMs(input))});
      return {output,provider:"blender-auto-rig"};
    }
    case "manhua_previs": {
      const { renderManhuaPrevis } = await import("../services/manhuaPrevisRender");
      const output = await renderManhuaPrevis(input.params,userId,{signal:options?.signal ?? AbortSignal.timeout(600_000)});
      return {output,provider:"blender-previs"};
    }
    case "audio_trim": {
      const output = await trimAudio(input.params, userId, runOptions);
      return { output, provider: "ffmpeg-post-prod" };
    }
    case "audio_extract": {
      const output = await extractAudio(input.params, userId, runOptions);
      return { output, provider: "ffmpeg-post-prod" };
    }
    case "audio_timeline": {
      const output = await renderAudioTimeline(input.params, userId, runOptions);
      return { output, provider: "ffmpeg-post-prod" };
    }
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
    case "burn_subtitle": {
      const output = await burnSubtitle(input.params, userId, runOptions);
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

/** 后期任务默认 10 分钟封顶（ffmpeg 拼接）。 */
export const POST_PROD_DEFAULT_TIMEOUT_MS = 10 * 60_000;
/**
 * 0917 线上实测：阿菁 A-pose 真模（737,797 顶点）绑定阶段在 2 vCPU 上 >10 分钟被 600 秒硬超时杀掉
 *（检查阶段 6–8 分钟能过）。绑定单独放宽：默认 30 分钟，env 只能上调、不能低于 10 分钟。
 */
export const MANHUA_AUTO_RIG_BIND_DEFAULT_TIMEOUT_MS = 30 * 60_000;
export function resolvePostProdJobTimeoutMs(rawInput: unknown, env: NodeJS.ProcessEnv = process.env): number {
  const input = rawInput as { action?: unknown; params?: { stage?: unknown } } | null;
  if (input && input.action === "manhua_auto_rig" && input.params && input.params.stage === "bind") {
    const raw = Number(env.MANHUA_AUTO_RIG_BIND_TIMEOUT_MS);
    if (Number.isFinite(raw) && raw > 0) return Math.max(POST_PROD_DEFAULT_TIMEOUT_MS, Math.floor(raw));
    return MANHUA_AUTO_RIG_BIND_DEFAULT_TIMEOUT_MS;
  }
  return POST_PROD_DEFAULT_TIMEOUT_MS;
}

export async function runPostProdJobWithLimit(
  rawInput: unknown,
  userId: string,
  timeoutMs: number,
): Promise<{ output: unknown; provider: string }> {
  return runWithTaskLimit(timeoutMs, (signal) => processPostProdJob(rawInput, userId, { signal }));
}
