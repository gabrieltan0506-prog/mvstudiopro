/** 原生精读单任务墙钟与调用数契约；客户端、入队端和 worker 共用。 */
import { isManhua0996SourceUrl } from "./manhuaLearn0996Source.js";
/**
 * 0826 拍板：视觉学习整体从新加坡 Qwen 换到 Vertex Gemini 3.1 Pro 从 GCS 直读，
 * 连音轨一次调用出全六栏（实测 360s 段 144s 返回，输入 ≈129k tok）。
 */
export const MANHUA_NATIVE_DEEP_READ_MODEL = "gemini-3.1-pro-preview" as const;
export const MANHUA_NATIVE_DEEP_READ_MODEL_LABEL = "Gemini 3.1 Pro" as const;

export const NATIVE_DEEP_READ_JOB_PREP_MS = 10 * 60_000;
export const NATIVE_DEEP_READ_JOB_PER_CALL_MS = 35 * 60_000;
export const NATIVE_DEEP_READ_JOB_MAX_WALL_MS = 24 * 60 * 60_000;

/**
 * 用户可选集数不能再被旧的“每次调用均串行 35 分钟”假设卡死。
 * 双音轨两路并行、视觉又按多视频装箱；这里仅保留防失控硬顶，墙钟另行封顶 24 小时。
 */
export const NATIVE_DEEP_READ_JOB_MAX_CALLS = 200;

export const NATIVE_DEEP_READ_JOB_FIELDS = [
  "nativeDeepReadConfirmed",
  "nativePlanHash",
  "nativeMaxCalls",
  "nativePlanLimit",
  "nativePlanSeriesKey",
] as const;

export type NativeDeepReadJobConfirmation = {
  url: string;
  /** 旧任务的精确计划指纹；新面板直接入队时为空，由 worker 在任务内生成执行计划。 */
  planHash?: string;
  maxCalls: number;
  planLimit: number;
  /** 与 planHash 成对出现，仅用于兼容已经入队的旧任务。 */
  seriesKey?: string;
  learnLlm: "gpt" | "claude" | "deepseek";
};

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
