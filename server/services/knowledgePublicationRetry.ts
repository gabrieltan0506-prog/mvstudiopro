import type { EditableLayout } from "../../shared/editableLayout";
import { knowledgeBatchRequestId, knowledgeReviewBatches } from "../../shared/knowledgePublication";
import { getJobByIdStrict } from "../jobs/repository";
import { readChargeRefundState } from "../credits";
import { downloadGcsObjectVersioned, getGcsBucketName } from "./gcs";
import { canonicalRefundKey } from "./paidJobLedger";
import { manhuaAdvisorOperationId, MANHUA_ADVISOR_FAILED_ACTION, MANHUA_ADVISOR_REFUND_RECONCILED_ACTION } from "./manhuaAdvisorOperation";
import { KNOWLEDGE_PUBLICATION_RECEIPT_ROUTES } from "./knowledgeModelCapabilities";

const real = {
  job: getJobByIdStrict,
  billing: readChargeRefundState,
  read: async (name: string): Promise<any> => {
    try {
      const value = await downloadGcsObjectVersioned({ gcsUri: `gs://${getGcsBucketName()}/${name}` });
      return JSON.parse(value.buffer.toString("utf8"));
    } catch (error) {
      if (error instanceof Error && error.message === "gcs_stat_failed:404") return null;
      throw error;
    }
  },
};

/** 保存新编号前与实际调用前共用；本地失败不能代替原模型结果及退款对账。 */
export async function checkKnowledgePublicationRetry(
  owner: number, doc: EditableLayout, batchIndex: number, previousAttempt: number,
  overrides: Partial<typeof real> = {},
) {
  const pub = doc.publication;
  if (!pub || !Number.isSafeInteger(batchIndex) || batchIndex < 0 || !Number.isSafeInteger(previousAttempt) || previousAttempt < 0)
    throw new Error("整理重试编号无效，请恢复原请求");
  const deps = { ...real, ...overrides };
  const requestId = knowledgeBatchRequestId(pub.requestId, batchIndex, previousAttempt);
  const jobId = manhuaAdvisorOperationId(owner, requestId);
  const job = await deps.job(jobId);
  const input = job?.input as { requestId?: string } | null;
  const output = job?.output as { action?: string; creditsRefunded?: number } | null;
  if (!job || String(job.userId) !== String(owner) || input?.requestId !== requestId || job.status !== "failed" ||
      ![MANHUA_ADVISOR_FAILED_ACTION, MANHUA_ADVISOR_REFUND_RECONCILED_ACTION].includes(output?.action || ""))
    throw new Error("上一批请求未确认失败或退款未闭合，请恢复原请求，不能新开重试");
  const billing = await deps.billing(owner, `manhuaAdvisor/${jobId}`, canonicalRefundKey("manhuaAdvisor", jobId));
  if (!billing.settled || (billing.charged > 0 &&
      (output?.action !== MANHUA_ADVISOR_REFUND_RECONCILED_ACTION || !(Number(output?.creditsRefunded) >= billing.charged))))
    throw new Error("上一批请求退款未闭合，请恢复原请求，不能新开重试");
  const count = knowledgeReviewBatches(pub.source).length;
  const batch = batchIndex < count ? `batch-${batchIndex}` : `consistency-${batchIndex - count}`;
  const root = `knowledge-publications/user-${owner}/${doc.id}/${pub.requestId}/${batch}`;
  const prefix = `${root}/attempt-${previousAttempt}`;
  for (const key of [`${root}/report.json`, `${root}/raw-${previousAttempt}.json`, `${prefix}/accepted.json`]) {
    if (await deps.read(key)) throw new Error("原请求已有结果，请恢复原请求，不能再次付费整理");
  }
  for (const route of KNOWLEDGE_PUBLICATION_RECEIPT_ROUTES) {
    const receipt = await deps.read(`${prefix}/route-${route}.json`);
    if (!receipt) continue;
    if (receipt.state === "unavailable" && receipt.sent !== true) continue;
    if (receipt.state === "failed" && (receipt.sent === false ||
        (Number.isInteger(receipt.response?.status) && typeof receipt.response?.text === "string"))) continue;
    throw new Error("上一次整理结果尚待核实，不能新开付费重试；原稿已保留");
  }
}

/** 被拒绝的重试不写入新attempt，原稿仍能通过旧编号恢复。 */
export async function validateKnowledgePublicationRetryTransition(
  owner: number, before: EditableLayout, after: EditableLayout, check = checkKnowledgePublicationRetry,
) {
  const old = before.publication, next = after.publication;
  if (!old || !next) return;
  const keys = new Set([...Object.keys(old.attempts), ...Object.keys(next.attempts)]);
  const changed = Array.from(keys).filter(key => (old.attempts[key] || 0) !== (next.attempts[key] || 0));
  if (!changed.length) return;
  const key = changed[0], batchIndex = Number(key), previousAttempt = old.attempts[key] || 0;
  if (changed.length !== 1 || !/^(0|[1-9]\d*)$/.test(key) || !Number.isSafeInteger(batchIndex) ||
      next.attempts[key] !== previousAttempt + 1 || batchIndex !== old.completedBatches ||
      next.completedBatches !== old.completedBatches || old.requestId !== next.requestId)
    throw new Error("整理重试必须沿用当前未完成批次，不能跳号或覆盖原请求");
  await check(owner, before, batchIndex, previousAttempt);
}
