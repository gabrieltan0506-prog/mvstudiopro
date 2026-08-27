/** 原生精读每一次模型调用的可持久化回执；不得包含凭证或可直接访问的签名媒体地址。 */
export type ManhuaNativeProviderErrorReceipt = {
  httpStatus?: number;
  code?: string;
  message?: string;
  requestId?: string;
  param?: string;
  type?: string;
  /** 脱敏后的原始错误 JSON；保留供应商额外字段，禁止放请求载荷。 */
  responseBody?: string;
};

export type ManhuaNativeModelReceipt = {
  /** 单次真实外呼的唯一标识；started 与 terminal 用同一值做原位更新。 */
  callId: string;
  model: string;
  route: string;
  provider?: string;
  /** 成功与失败都保留上游单号；providerError 只负责错误正文。 */
  providerRequestId?: string;
  stage: "audio_model" | "visual_model" | "visual_parse" | "series_aggregation_model";
  status: "started" | "completed" | "failed";
  atIso?: string;
  startedAtIso?: string;
  finishedAtIso?: string;
  episodeIndexes: number[];
  chunkIndex?: number;
  /** 本集分片总数：供进度文案显示「分片 X/N」，防「完成」误读为整集完成 */
  segmentCount?: number;
  /** 同一分片当前是第几次真实模型尝试（1–3）。 */
  attemptNumber?: number;
  /** 本次尝试实际发送的温度；用于对账 0.70→0.65→0.60 降温序列。 */
  temperature?: number;
  variant?: "mono_16k" | "stereo_32k";
  batchRequestId?: string;
  videoCount?: number;
  elapsedMs?: number;
  inputTokens?: number;
  audioInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  priceEquivalentCny?: number;
  finishReason?: string;
  /** EvoLink 兜底为 1fps 降级读取（忽略 videoMetadata.fps）；降级调用必须带标 */
  degraded?: boolean;
  errorZh?: string;
  providerError?: ManhuaNativeProviderErrorReceipt;
};

export const MANHUA_NATIVE_MODEL_RECEIPT_MAX = 1_024;

/**
 * 每次外呼只保留一条：started 先落盘，terminal 原位补齐同一 callId。
 * 这既能实时看进行中，也不会让 200 次外呼产生 400+ 条而裁掉早期回执。
 */
export function appendManhuaNativeModelReceipt(
  previous: readonly ManhuaNativeModelReceipt[],
  next: ManhuaNativeModelReceipt,
  atIso = new Date().toISOString(),
): ManhuaNativeModelReceipt[] {
  const row: ManhuaNativeModelReceipt = {
    ...next,
    callId: String(next.callId || "").trim().slice(0, 128),
    model: String(next.model || "").trim().slice(0, 128),
    route: String(next.route || "").trim().slice(0, 128),
    provider: String(next.provider || "").trim().slice(0, 128) || undefined,
    providerRequestId: String(next.providerRequestId || "").trim().slice(0, 256) || undefined,
    atIso: String(next.atIso || atIso),
    episodeIndexes: Array.from(new Set(next.episodeIndexes
      .map((value) => Math.floor(Number(value)))
      .filter((value) => value >= 1))).sort((a, b) => a - b),
  };
  const index = previous.findIndex((item) =>
    item.callId === row.callId && item.stage === row.stage);
  if (index < 0) {
    return [...previous, {
      ...row,
      startedAtIso: row.status === "started" ? row.atIso : row.startedAtIso,
      finishedAtIso: row.status === "started" ? undefined : row.atIso,
    }].slice(-MANHUA_NATIVE_MODEL_RECEIPT_MAX);
  }
  const merged = [...previous];
  const prior = previous[index]!;
  merged[index] = {
    ...prior,
    ...row,
    startedAtIso: prior.startedAtIso || (prior.status === "started" ? prior.atIso : row.startedAtIso),
    finishedAtIso: row.status === "started" ? prior.finishedAtIso : row.atIso,
    providerError: row.providerError || prior.providerError,
  };
  return merged.slice(-MANHUA_NATIVE_MODEL_RECEIPT_MAX);
}
