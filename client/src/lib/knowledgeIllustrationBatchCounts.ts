/**
 * 读取出图批次错误里的分项计数（1119，兼容线 D 的 KnowledgeIllustrationBatchError：
 * 批次未全成功时抛错并携带 succeeded / failed / pending-verification / not-dispatched）。
 * 旧版批次函数抛的是普通错误：返回 null，调用方回落到按已回填页数计。
 * 只读，不改错误、不触发任何请求。
 */
export type KnowledgeIllustrationBatchCounts = { succeeded: number; failed: number; pending: number; notDispatched: number };

const num = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

export function knowledgeIllustrationBatchCounts(error: unknown): KnowledgeIllustrationBatchCounts | null {
  if (!error || typeof error !== "object") return null;
  const raw = error as Record<string, unknown>;
  const src = (raw.counts && typeof raw.counts === "object" ? raw.counts : raw) as Record<string, unknown>;
  const succeeded = num(src.succeeded);
  const failed = num(src.failed);
  const pending = num(src.pendingVerification ?? src.pending);
  const notDispatched = num(src.notDispatched);
  if (succeeded === null || failed === null) return null;
  return { succeeded, failed, pending: pending ?? 0, notDispatched: notDispatched ?? 0 };
}

/** 失败提示：已出页保留并计费；结果待核实的页不重购；未发出的页不扣。 */
export function knowledgeIllustrationBatchSummaryZh(counts: KnowledgeIllustrationBatchCounts): string {
  const parts = [`已完成 ${counts.succeeded} 页（按已成功页计费）`];
  if (counts.failed) parts.push(`失败 ${counts.failed} 页（不扣费，可逐页补出）`);
  if (counts.pending) parts.push(`${counts.pending} 页结果待核实（不会重复购买）`);
  if (counts.notDispatched) parts.push(`${counts.notDispatched} 页未发出（不扣费）`);
  return parts.join("，");
}
