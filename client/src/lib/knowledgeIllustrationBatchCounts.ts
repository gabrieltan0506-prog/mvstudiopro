/**
 * 读取出图批次错误里的分项计数（1119，兼容线 D 的 KnowledgeIllustrationBatchError：
 * 批次未全成功时抛错，`summary` 带 succeeded / failed / unknown(或 pendingVerification / pending) / notDispatched / stoppedBy）。
 * 也接受早先约定的 `counts` 字段或平铺字段。旧版批次函数抛的是普通错误：返回 null，调用方回落到按已回填页数计。
 * 只读，不改错误、不触发任何请求。
 */
export type KnowledgeIllustrationBatchCounts = {
  succeeded: number; failed: number; pending: number; notDispatched: number;
  /** 批次停领新页的原因（batch_fatal＝整批必败；unknown＝结果未知；inactive/null＝用户停止或未停） */
  stoppedBy?: string | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const obj = (v: unknown) => (v && typeof v === "object" ? v as Record<string, unknown> : null);

export function knowledgeIllustrationBatchCounts(error: unknown): KnowledgeIllustrationBatchCounts | null {
  const raw = obj(error);
  if (!raw) return null;
  const src = obj(raw.summary) || obj(raw.counts) || raw;
  const succeeded = num(src.succeeded);
  const failed = num(src.failed);
  const pending = num(src.unknown ?? src.pendingVerification ?? src.pending);
  const notDispatched = num(src.notDispatched);
  if (succeeded === null || failed === null) return null;
  const stoppedBy = typeof src.stoppedBy === "string" ? src.stoppedBy : null;
  return { succeeded, failed, pending: pending ?? 0, notDispatched: notDispatched ?? 0, stoppedBy };
}

/** 失败提示：已出页保留并计费；结果待核实的页不重购；未发出的页不扣。 */
export function knowledgeIllustrationBatchSummaryZh(counts: KnowledgeIllustrationBatchCounts): string {
  const parts = [`已完成 ${counts.succeeded} 页（按已成功页计费）`];
  if (counts.failed) parts.push(`失败 ${counts.failed} 页（不扣费，可逐页补出）`);
  if (counts.pending) parts.push(`${counts.pending} 页结果待核实（不会自动重新购买）`);
  if (counts.notDispatched) parts.push(`${counts.notDispatched} 页未发出（不扣费）`);
  return parts.join("，");
}

/**
 * 普通用户可见的批次失败句：只由计数拼成，不带任何底层错误原文（原文可能含模型/供应商名或「(401)」，
 * 交给通用脱敏会整句替换，连已完成页数都丢掉）。
 */
export function knowledgeIllustrationBatchUserMessage(counts: KnowledgeIllustrationBatchCounts): string {
  const head = counts.stoppedBy === "batch_fatal" ? "配图服务暂不可用，已停止派发新页" : counts.stoppedBy === "unknown" ? "有页面结果待核实，已停止派发新页" : "配图未全部完成";
  return `${head}：${knowledgeIllustrationBatchSummaryZh(counts)}`;
}
