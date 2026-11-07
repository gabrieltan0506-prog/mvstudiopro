import { and, eq, sql } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import {
  knowledgeReviewBatches,
  type KnowledgePublicationContext,
} from "../../shared/knowledgePublication";
import { getDb } from "../db";
import { getJobByIdStrict } from "../jobs/repository";
import { readChargeRefundState } from "../credits";
import { canonicalRefundKey } from "./paidJobLedger";
import { downloadGcsObjectVersioned, getGcsBucketName } from "./gcs";
import {
  validateKnowledgePublicationAccess,
  reviewKnowledgePublication,
  knowledgeEvidencePrefix,
} from "./knowledgePublicationAdvisor";
import {
  invokeKnowledgePublicationRoutes,
  type KnowledgeModelRequest,
} from "./knowledgePublicationRoutes";
import {
  manhuaAdvisorOperationId,
  manhuaAdvisorRequestFingerprint,
  MANHUA_ADVISOR_JOB_ACTION,
  MANHUA_ADVISOR_DONE_ACTION,
  MANHUA_ADVISOR_FAILED_ACTION,
  MANHUA_ADVISOR_REFUND_RECONCILED_ACTION,
  type ManhuaAdvisorQaResponse,
} from "./manhuaAdvisorOperation";

type Input = Parameters<typeof manhuaAdvisorRequestFingerprint>[0] & {
  userId: number;
  requestId: string;
  knowledgePublicationContext: KnowledgePublicationContext;
};
type Metadata = Pick<
  ManhuaAdvisorQaResponse,
  "qaMode" | "dailyLimit" | "paidUnitCredits"
>;
const real = {
  job: getJobByIdStrict,
  billing: readChargeRefundState,
  access: validateKnowledgePublicationAccess,
  review: reviewKnowledgePublication,
  read: async (name: string): Promise<any> => {
    try {
      return JSON.parse(
        (
          await downloadGcsObjectVersioned({
            gcsUri: `gs://${getGcsBucketName()}/${name}`,
          })
        ).buffer.toString()
      );
    } catch (e) {
      if (e instanceof Error && e.message === "gcs_stat_failed:404")
        return null;
      throw e;
    }
  },
  persist: async (
    jobId: string,
    owner: number,
    fingerprint: string,
    result: ManhuaAdvisorQaResponse,
    previous: any,
    billing: any
  ) => {
    const db = await getDb();
    if (!db) throw Error("数据库不可用，原恢复结果保留");
    const output = {
      action: MANHUA_ADVISOR_DONE_ACTION,
      requestFingerprint: fingerprint,
      result: { ...result, replayed: undefined },
      recovery: {
        kind: "original_publication_receipt",
        at: new Date().toISOString(),
        modelRequests: 0,
        previousStatus: previous.status,
        previousError: previous.error,
        previousOutput: previous.output,
        billing,
      },
    };
    const changed = await db
      .update(jobs)
      .set({ status: "succeeded", output, error: null, updatedAt: new Date() })
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.userId, String(owner)),
          eq(jobs.status, "failed"),
          sql`${jobs.input}->>'requestFingerprint' = ${fingerprint}`,
          sql`${jobs.output}->>'action' in (${MANHUA_ADVISOR_FAILED_ACTION},${MANHUA_ADVISOR_REFUND_RECONCILED_ACTION})`
        )
      )
      .returning({ id: jobs.id });
    if (changed.length) return;
    const current = await getJobByIdStrict(jobId),
      saved = current?.output as any;
    if (
      current?.status === "succeeded" &&
      saved?.requestFingerprint === fingerprint &&
      saved?.result?.answer === result.answer
    )
      return;
    throw Error("原任务状态已变化，未覆盖；请恢复原请求");
  },
};

/** 正式失败入口仅重验原LLM回包；不新建事务、不发模型、不重复扣费。 */
export async function recoverKnowledgePublicationOperation(
  input: Input,
  metadata: Metadata,
  overrides: Partial<typeof real> = {}
) {
  const context = input.knowledgePublicationContext;
  // 课件、读档、交流各有独立合同；不能从此入口启动其模型。
  if (context.purpose) return null;
  const deps = { ...real, ...overrides },
    jobId = manhuaAdvisorOperationId(input.userId, input.requestId),
    fingerprint = manhuaAdvisorRequestFingerprint(input);
  const job = await deps.job(jobId),
    stored = job?.input as any,
    output = job?.output as any;
  if (
    !job ||
    String(job.userId) !== String(input.userId) ||
    stored?.action !== MANHUA_ADVISOR_JOB_ACTION ||
    stored?.requestId !== input.requestId ||
    stored?.requestFingerprint !== fingerprint
  )
    throw Error("原任务身份不符，未恢复");
  if (
    job.status !== "failed" ||
    ![
      MANHUA_ADVISOR_FAILED_ACTION,
      MANHUA_ADVISOR_REFUND_RECONCILED_ACTION,
    ].includes(output?.action)
  )
    return null;
  const doc = await deps.access(input.userId, context, input.requestId);
  if (!("publication" in doc) || !doc.publication)
    throw Error("原稿出版信息缺失，未恢复");
  if (
    context.batchIndex >= knowledgeReviewBatches(doc.publication.source).length
  )
    return null;
  const billing = await deps.billing(
    input.userId,
    `manhuaAdvisor/${jobId}`,
    canonicalRefundKey("manhuaAdvisor", jobId)
  );
  if (
    !billing.settled ||
    (billing.charged > 0 &&
      (output.action !== MANHUA_ADVISOR_REFUND_RECONCILED_ACTION ||
        !(Number(output.creditsRefunded) >= billing.charged)))
  )
    throw Error("原任务退款未闭合，未恢复");
  const prefix =
    knowledgeEvidencePrefix(input.userId, doc.id, doc.publication.requestId) +
    `/batch-${context.batchIndex}`;
  // 重新校验原始模型响应，不能用代理曾补写的规范化报告替代自动恢复验证。
  const ignored = new Set([
    `${prefix}/report.json`,
    `${prefix}/raw-${context.attempt}.json`,
    `${prefix}/attempt-${context.attempt}/accepted.json`,
  ]);
  const read = (name: string) =>
    ignored.has(name) ? Promise.resolve(null) : deps.read(name);
  const review = await deps.review(input.userId, context, {
    read,
    post: (request, evidence) =>
      invokeKnowledgePublicationRoutes(
        request as KnowledgeModelRequest,
        evidence,
        {
          key: () => {
            throw Error("原回包不足以恢复，未提交新模型请求");
          },
          fetch: async () => {
            throw Error("原回包不足以恢复，未提交新模型请求");
          },
        }
      ),
  });
  const result: ManhuaAdvisorQaResponse = {
    success: true,
    replayed: true,
    answer: JSON.stringify(review),
    ...metadata,
    usedToday: 0,
    remainingFreeToday: metadata.dailyLimit,
    creditsCharged: 0,
    paidThisTurn: false,
    imageOffer: null,
  };
  await deps.persist(jobId, input.userId, fingerprint, result, job, billing);
  return result;
}
