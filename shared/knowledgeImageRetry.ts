export type KnowledgeImageRetryReason = "not_charged" | "refunded" | "pending";
export function knowledgeImageMayRetry(job: { status: string; input?: unknown; output?: unknown }): boolean {
  if (job.status !== "failed") return false;
  const input = job.input as { action?: string; params?: unknown; cancelRequestedAt?: unknown } | null;
  // 页面离开早于入队所写的取消墓碑：没有请求参数，因而没有执行或扣费。
  if (input?.action === "platform_composite_sheet_progress" && typeof input.cancelRequestedAt === "string" && !input.params) return true;
  const value = (job.output as { knowledgeImageRetry?: { version?: number; reason?: string } } | null)?.knowledgeImageRetry;
  return value?.version === 1 && (value.reason === "not_charged" || value.reason === "refunded");
}
