/**
 * 付费提交的结果分型（七审第7条抽共享：此前 OpenRouter/EvoLink/WaveSpeed 各自一套或没有）。
 *
 * rejected = 上游明确 4xx 拒绝，确定没建单 → 换下一通道是安全的；
 * unknown  = 网络断 / 5xx / 2xx 缺任务号 —— 任务可能已建成 → 禁止回落、禁止退款，转人工对账。
 * 判定统一用 `(e as any)?.kind`，不依赖类身份（跨模块/mock 场景稳定）。
 */
export class SubmitRejectedError extends Error {
  readonly kind = "rejected";
}
export class SubmitUnknownError extends Error {
  readonly kind = "unknown";
}
