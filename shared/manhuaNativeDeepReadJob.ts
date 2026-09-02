/** 原生精读单任务墙钟与调用数契约；客户端、入队端和 worker 共用。 */
import { isManhua0996SourceUrl } from "./manhuaLearn0996Source.js";
import { MANHUA_LEARN_MAX_DURATION_SEC } from "./manhuaTemplateLearnSeries.js";
/**
 * 0826 拍板：视觉学习整体从新加坡 Qwen 换到 Vertex Gemini 3.1 Pro 从 GCS 直读，
 * 连音轨一次调用出全六栏（实测 360s 段 144s 返回，输入 ≈129k tok）。
 */
export const MANHUA_NATIVE_DEEP_READ_MODEL = "gemini-3.1-pro-preview" as const;
export const MANHUA_NATIVE_DEEP_READ_MODEL_LABEL = "Gemini 3.1 Pro" as const;
/** 用户确认：GLM-5.3 整集结构化、系列聚合及同源探针统一使用官方支持的 high。 */
export const MANHUA_NATIVE_GLM_REASONING_EFFORT = "high" as const;

export const NATIVE_DEEP_READ_JOB_PREP_MS = 10 * 60_000;
export const NATIVE_DEEP_READ_JOB_PER_CALL_MS = 35 * 60_000;
export const NATIVE_DEEP_READ_JOB_MAX_WALL_MS = 24 * 60 * 60_000;

/**
 * 用户可选集数不能再被旧的“每次调用均串行 35 分钟”假设卡死。
 * 双音轨两路并行、视觉又按多视频装箱；这里仅保留防失控硬顶，墙钟另行封顶 24 小时。
 */
export const NATIVE_DEEP_READ_JOB_MAX_CALLS = 200;
/** 同源已有任务但本次确认参数不同；客户端必须保留旧运行卡，不得画成失败。 */
export const MANHUA_NATIVE_DEEP_READ_ACTIVE_PARAMS_CONFLICT_CODE =
  "MANHUA_NATIVE_DEEP_READ_ACTIVE_PARAMS_CONFLICT" as const;

/** 默认分片长度，不是单片硬上限；采样率由独立设置控制。 */
export const NATIVE_DEEP_READ_DEFAULT_SEGMENT_SECONDS = 300;
/** 沿用整片两小时策略，不再另外限制分片为 300 秒。 */
export const NATIVE_DEEP_READ_MAX_SEGMENT_SECONDS = MANHUA_LEARN_MAX_DURATION_SEC;
/**
 * 当前默认12fps；用户已要求不继续提高采样率。
 * 分片时长与采样率独立配置，实际请求使用调用方确认的值。
 * 历史镜数和费用应查对应请求及回执，不据镜数推断所有切镜真实或所有帧均被模型处理。
 */
export const NATIVE_DEEP_READ_DEFAULT_VIDEO_FPS = 12;
/** Google VideoMetadata.fps 的接口范围为 (0, 24]。 */
export const NATIVE_DEEP_READ_MAX_VIDEO_FPS = 24;

export function parseNativeDeepReadVideoFps(value: unknown): number {
  if (value === undefined) return NATIVE_DEEP_READ_DEFAULT_VIDEO_FPS;
  if (
    (typeof value !== "number" && typeof value !== "string")
    || (typeof value === "string" && !value.trim())
  ) {
    throw new Error(`视频采样 fps 必须大于 0 且不超过 ${NATIVE_DEEP_READ_MAX_VIDEO_FPS}`);
  }
  const fps = Number(value);
  if (!Number.isFinite(fps) || fps <= 0 || fps > NATIVE_DEEP_READ_MAX_VIDEO_FPS) {
    throw new Error(`视频采样 fps 必须大于 0 且不超过 ${NATIVE_DEEP_READ_MAX_VIDEO_FPS}`);
  }
  return fps;
}

export function parseNativeDeepReadSegmentSeconds(value: unknown): number {
  if (value === undefined) return NATIVE_DEEP_READ_DEFAULT_SEGMENT_SECONDS;
  if (
    (typeof value !== "number" && typeof value !== "string")
    || (typeof value === "string" && !value.trim())
  ) {
    throw new Error(`分片时长必须为 1–${NATIVE_DEEP_READ_MAX_SEGMENT_SECONDS} 的整数秒`);
  }
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > NATIVE_DEEP_READ_MAX_SEGMENT_SECONDS) {
    throw new Error(`分片时长必须为 1–${NATIVE_DEEP_READ_MAX_SEGMENT_SECONDS} 的整数秒`);
  }
  return seconds;
}

export const NATIVE_DEEP_READ_JOB_FIELDS = [
  "nativeDeepReadConfirmed",
  "nativePlanHash",
  "nativeMaxCalls",
  "nativePlanLimit",
  "nativePlanSeriesKey",
  "nativeSegmentSeconds",
  "nativeVideoFps",
  "nativeStandaloneSource",
] as const;

export type NativeDeepReadJobConfirmation = {
  url: string;
  /** 旧任务的精确计划指纹；新面板直接入队时为空，由 worker 在任务内生成执行计划。 */
  planHash?: string;
  maxCalls: number;
  planLimit: number;
  /** 缺省＝分片按集自动配平（0902）；显式数值＝用户手填的每片上限 */
  segmentSeconds?: number;
  videoFps: number;
  /**
   * 0901 用户令「整支即全集」：抖音大量全集长视频仍挂 mixId 但合集列表被风控/收编，
   * 勾选后跳过合集展开，按独立长视频单集学习（身份仍只绑 awemeId）。
   */
  standaloneSource: boolean;
  /** 与 planHash 成对出现，仅用于兼容已经入队的旧任务。 */
  seriesKey?: string;
  learnLlm: "gpt" | "claude" | "deepseek";
};

/** 同源任务只有整份确认契约一致时才可复用，不能让新面板参数接管旧 jobId。 */
export function sameNativeDeepReadJobConfirmation(
  left: NativeDeepReadJobConfirmation,
  right: NativeDeepReadJobConfirmation,
): boolean {
  return left.url === right.url
    && left.planHash === right.planHash
    && left.maxCalls === right.maxCalls
    && left.planLimit === right.planLimit
    && left.segmentSeconds === right.segmentSeconds
    && left.videoFps === right.videoFps
    && left.standaloneSource === right.standaloneSource
    && left.seriesKey === right.seriesKey
    && left.learnLlm === right.learnLlm;
}

export function hasNativeDeepReadJobFields(params: Record<string, unknown>): boolean {
  return NATIVE_DEEP_READ_JOB_FIELDS.some((key) =>
    Object.prototype.hasOwnProperty.call(params, key));
}

/** API 入口与 worker 共用的单次确认契约；任何旁路字段都关闭式拒绝。 */
export function parseNativeDeepReadJobConfirmation(
  params: Record<string, unknown>,
  options: { extraSourceHosts?: readonly string[] } = {},
): NativeDeepReadJobConfirmation {
  const url = String(params.url || "").trim();
  const planHash = String(params.nativePlanHash || "").trim();
  const maxCalls = Number(params.nativeMaxCalls);
  const planLimit = Number(params.nativePlanLimit);
  const batchSize = Number(params.batchSize);
  const seriesKey = String(params.nativePlanSeriesKey || "").trim();
  // 0902：缺省不再折算成默认 300——保留 undefined 让计划层按集自动配平
  const segmentSeconds = params.nativeSegmentSeconds == null
    ? undefined
    : parseNativeDeepReadSegmentSeconds(params.nativeSegmentSeconds);
  const videoFps = parseNativeDeepReadVideoFps(params.nativeVideoFps);
  const standaloneRaw = params.nativeStandaloneSource;
  if (standaloneRaw !== undefined && standaloneRaw !== true && standaloneRaw !== false
    && standaloneRaw !== "true" && standaloneRaw !== "false") {
    throw new Error("整支即全集开关必须为布尔值");
  }
  const standaloneSource = standaloneRaw === true || standaloneRaw === "true";
  const hasLegacyPlanConfirmation = Boolean(planHash || seriesKey);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("原生精读来源链接无效");
  }
  if (
    params.nativeDeepReadConfirmed !== true
    || parsedUrl.protocol !== "https:"
    || (
      !/(?:^|\.)douyin\.com$/i.test(parsedUrl.hostname)
      && !isManhua0996SourceUrl(url, options.extraSourceHosts)
    )
    || !Number.isInteger(maxCalls)
    || maxCalls < 1
    || maxCalls > NATIVE_DEEP_READ_JOB_MAX_CALLS
    || !Number.isInteger(planLimit)
    || planLimit < 1
    || planLimit > 200
    || batchSize !== planLimit
    || (
      hasLegacyPlanConfirmation
      && (!/^[0-9a-f]{16}$/.test(planHash) || !/^[0-9A-Za-z_-]{1,40}$/.test(seriesKey))
    )
    || String(params.gcsUri || "").trim()
    || params.refreshPreviewFrames === true
    || params.retrySkippedEpisodes === true
  ) {
    throw new Error("原生精读确认参数不完整或相互冲突");
  }
  return {
    url,
    planHash: planHash || undefined,
    maxCalls,
    planLimit,
    segmentSeconds,
    videoFps,
    standaloneSource,
    seriesKey: seriesKey || undefined,
    learnLlm:
      params.learnLlm === "claude" || params.learnLlm === "deepseek"
        ? params.learnLlm
        : "gpt",
  };
}

export function resolveNativeDeepReadJobTimeoutMs(modelCalls: number): number {
  const calls = Number(modelCalls);
  if (!Number.isInteger(calls) || calls < 1 || calls > NATIVE_DEEP_READ_JOB_MAX_CALLS) {
    throw new Error(`单任务模型请求数必须为 1–${NATIVE_DEEP_READ_JOB_MAX_CALLS}`);
  }
  return Math.min(
    NATIVE_DEEP_READ_JOB_MAX_WALL_MS,
    NATIVE_DEEP_READ_JOB_PREP_MS + calls * NATIVE_DEEP_READ_JOB_PER_CALL_MS,
  );
}
