import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { jobs } from "../../drizzle/schema-jobs.js";
import { userCreations } from "../../drizzle/schema-creations.js";
import { getDb } from "../db.js";
import { getCredits, deductCreditsAmount, refundChargeByKey } from "../credits.js";
import { CREDIT_COSTS, platformCoverBundleTotalCredits, platformBundleCreditsForSlot } from "../../shared/plans.js";
import { COVER_DESIGNS, readCoverCandidateSet, type CoverCandidateSet } from "../../shared/platformCoverCandidates.js";
import { getJobByIdStrict, patchJobRunningProgressStrict } from "./repository.js";
import { assertOptimizedCoverInputsFromDb } from "../services/platformStrategicBlueprintSnapshots.js";
import { runCoverCandidates } from "../services/platformCoverCandidates.js";
import { postProcessPlatformCover } from "../services/platformCoverGrade.js";
import { signGsUriV4ReadUrl } from "../services/gcs.js";
import { gsUriFromSignedGcsUrl } from "../../shared/manhuaMultiview.js";

export const COVER_CANDIDATES_ACTION = "platform_cover_candidates";
export const coverCandidateRequest = z.object({
  sceneId: z.string().min(1).max(128),
  requestId: z.string().regex(/^[a-zA-Z0-9_-]{12,48}$/),
  expectedCredits: z.number().int().nonnegative(),
  coverPersonaContext: z.string().max(4000).optional(),
  referencePhotoUrl: z.string().url().max(2048).optional(),
  coverPlatformHint: z.string().max(40).optional(),
  bulkCoverPack: z.object({ packSceneIds: z.array(z.string().min(1).max(128)).min(1).max(24), sequentialSlot: z.number().int().nonnegative() }).optional(),
});

function parseSet(output: unknown) {
  const set = readCoverCandidateSet((output as { coverCandidateSet?: unknown } | null)?.coverCandidateSet);
  if (!set) throw new Error("封面候选记录不完整");
  return set;
}
const publicUrl = (url?: string) => url?.startsWith("gs://") ? signGsUriV4ReadUrl(url) : url;

export async function enqueueCoverCandidates(userId: number, exempt: boolean, raw: z.infer<typeof coverCandidateRequest>) {
  const input = coverCandidateRequest.parse(raw);
  const id = "cv3_" + createHash("sha256").update(`${userId}/${input.requestId}`).digest("hex").slice(0, 48);
  const db = await getDb();
  if (!db) throw new Error("暂时无法保存封面任务，未开始生成");
  const existing = await getJobByIdStrict(id);
  if (existing) {
    if (existing.userId !== String(userId)) throw new Error("无权访问此封面任务");
    if (parseSet(existing.output).sceneId !== input.sceneId) throw new Error("请求身份与选题不一致");
    return { jobId: id, reused: true };
  }
  const pack = input.bulkCoverPack;
  if (pack && (new Set(pack.packSceneIds).size !== pack.packSceneIds.length || pack.packSceneIds[pack.sequentialSlot] !== input.sceneId)) throw new Error("封面批次与选题不一致");
  const unit = pack ? platformBundleCreditsForSlot(platformCoverBundleTotalCredits(pack.packSceneIds.length), pack.sequentialSlot, pack.packSceneIds.length) : CREDIT_COSTS.platformTopicFrameGraphic;
  const costPerCandidate = exempt ? 0 : unit;
  if (input.expectedCredits !== costPerCandidate * 3) throw new Error("费用已变化，请刷新后确认三张封面的总费用");
  if (!exempt && (await getCredits(userId)).totalAvailable < costPerCandidate * 3) throw new Error("积分不足，尚未开始生成三张封面");
  // 冻结同一份已确认内容，三张不得在过程中读到不同版本。
  const source = await assertOptimizedCoverInputsFromDb({ userId, sceneId: input.sceneId, preferredPlatform: input.coverPlatformHint });
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS cover_candidates_one_active_per_scene
    ON jobs ("userId", (input->'params'->>'sceneId'))
    WHERE type='platform' AND input->>'action'='platform_cover_candidates' AND status IN ('queued','running')`);
  const set: CoverCandidateSet = { version: 1, jobId: id, sceneId: input.sceneId, selectedId: null,
    candidates: COVER_DESIGNS.map(d => ({ id: d.id, label: d.label, status: "pending", billing: "pending" })) };
  const inserted = await db.insert(jobs).values({ id, userId: String(userId), type: "platform", provider: "vertex", status: "queued",
    input: { action: COVER_CANDIDATES_ACTION, params: { source, sceneId: input.sceneId, costPerCandidate,
      coverPersonaContext: input.coverPersonaContext, referencePhotoUrl: input.referencePhotoUrl } },
    output: { coverCandidateSet: set },
  }).onConflictDoNothing().returning({ id: jobs.id });
  if (!inserted.length) {
    const raced = await getJobByIdStrict(id);
    if (raced?.userId === String(userId)) return { jobId: id, reused: true };
    throw new Error("这条内容已有封面候选正在制作，请查看已有任务，未重复扣费");
  }
  return { jobId: id, reused: false };
}

export async function getCoverCandidates(userId: number, sceneId: string) {
  const db = await getDb();
  if (!db) throw new Error("暂时无法读取封面候选");
  const [job] = await db.select().from(jobs).where(and(eq(jobs.userId, String(userId)),
    sql`${jobs.input}::jsonb->>'action' = ${COVER_CANDIDATES_ACTION}`,
    sql`${jobs.input}::jsonb->'params'->>'sceneId' = ${sceneId}`,
  )).orderBy(desc(jobs.createdAt)).limit(1);
  const [adopted] = await db.select({ outputUrl: userCreations.outputUrl }).from(userCreations).where(and(
    eq(userCreations.userId, userId), eq(userCreations.type, "platform_topic_frame"), eq(userCreations.status, "completed"),
    sql`${userCreations.metadata}::jsonb->>'sceneId' = ${sceneId}`,
    sql`${userCreations.metadata}::jsonb->>'coverCandidateJobId' IS NOT NULL`,
  )).orderBy(desc(userCreations.updatedAt), desc(userCreations.id)).limit(1);
  const set = job ? structuredClone(parseSet(job.output)) : null;
  if (set) for (const c of set.candidates) { c.originalUrl = publicUrl(c.originalUrl); c.imageUrl = publicUrl(c.imageUrl); c.receiptUrl = publicUrl(c.receiptUrl); }
  return { set, status: job?.status ?? null, adoptedUrl: publicUrl(adopted?.outputUrl ?? undefined) ?? null };
}

export async function selectCoverCandidate(userId: number, jobId: string, candidateId: string) {
  const job = await getJobByIdStrict(jobId);
  if (!job || job.userId !== String(userId) || (job.input as { action?: string }).action !== COVER_CANDIDATES_ACTION || !["succeeded", "failed"].includes(job.status)) throw new Error("封面仍在处理中或无权访问，请稍后选择");
  const set = structuredClone(parseSet(job.output));
  const c = set.candidates.find(c => c.id === candidateId);
  if (!c || c.status !== "ready" || !c.imageUrl || !c.originalUrl || !c.receiptUrl) throw new Error("这张尚未完成独立调色，不能采用");
  if (set.selectedId === candidateId) return { imageUrl: publicUrl(c.imageUrl)!, selectedId: candidateId };
  const db = await getDb();
  if (!db) throw new Error("保存失败，原封面保持不变");
  set.selectedId = candidateId;
  // 同一条SQL原子保存选择与最终消费者记录；CAS防止旧页面覆盖正在恢复的任务。
  const result = await db.execute(sql`
    WITH chosen AS (
      UPDATE jobs SET output = jsonb_set(output::jsonb, '{coverCandidateSet}', ${JSON.stringify(set)}::jsonb), "updatedAt" = NOW()
      WHERE id = ${jobId} AND "userId" = ${String(userId)} AND status = ${job.status}
        AND output::jsonb = ${JSON.stringify(job.output)}::jsonb RETURNING id
    )
    INSERT INTO user_creations ("userId", type, title, "outputUrl", "secondaryUrl", metadata, status, "creditsUsed", "createdAt", "updatedAt")
    SELECT ${userId}, 'platform_topic_frame', ${c.label}, ${c.imageUrl}, ${c.originalUrl},
      ${JSON.stringify({ sceneId: set.sceneId, coverCandidateJobId: jobId, selectedCandidateId: candidateId, receiptUrl: c.receiptUrl })}, 'completed', 0, NOW(), NOW()
    FROM chosen RETURNING id
  `);
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows;
  if (!rows?.length) throw new Error("封面状态已变化，请刷新后重新选择");
  return { imageUrl: publicUrl(c.imageUrl)!, selectedId: candidateId };
}

/** 只恢复原图后期/退款/未提交项；从不重投已成功或回执未知的像素请求。 */
export async function resumeCoverCandidates(userId: number, jobId: string) {
  const job = await getJobByIdStrict(jobId);
  if (!job || job.userId !== String(userId) || (job.input as { action?: string }).action !== COVER_CANDIDATES_ACTION) throw new Error("封面任务不存在或无权访问");
  if (["queued", "running"].includes(job.status)) return { jobId };
  const set = parseSet(job.output);
  if (!set.candidates.some(c => c.status === "pending" || c.status === "grading" || c.status === "generating" || c.billing === "refund_pending")) throw new Error("没有可恢复的候选、后期或退款步骤");
  const db = await getDb();
  if (!db) throw new Error("暂时无法恢复");
  const rows = await db.update(jobs).set({ status: "queued", error: null, updatedAt: new Date() }).where(and(eq(jobs.id, jobId), eq(jobs.userId, String(userId)), eq(jobs.status, job.status), sql`${jobs.output}::jsonb = ${JSON.stringify(job.output)}::jsonb`)).returning({ id: jobs.id });
  if (!rows.length) throw new Error("任务状态已变化，请刷新；没有重复提交");
  return { jobId };
}

export async function processCoverCandidatesJob(jobId: string, userId: string) {
  const job = await getJobByIdStrict(jobId);
  if (!job || job.userId !== userId) throw new Error("封面任务身份不匹配");
  const input = job.input as { action: string; params: { source: Awaited<ReturnType<typeof assertOptimizedCoverInputsFromDb>>; sceneId: string; costPerCandidate: number; coverPersonaContext?: string; referencePhotoUrl?: string } };
  if (input.action !== COVER_CANDIDATES_ACTION) throw new Error("封面任务类型不匹配");
  const { source, costPerCandidate, sceneId } = input.params;
  const { runPlatformTopicImagePipeline } = await import("../services/runPlatformTopicImagePipeline.js");
  const chargeKey = (id: string) => `coverCandidate/${userId}/${jobId}/${id}`;
  const set = await runCoverCandidates(parseSet(job.output), {
    save: set => patchJobRunningProgressStrict(jobId, { coverCandidateSet: set }),
    charge: async id => { if (costPerCandidate > 0) await deductCreditsAmount(Number(userId), costPerCandidate, "platformTopicImages", "封面候选独立生成与调色", { chargeKey: chargeKey(id) }); },
    refund: async id => { if (costPerCandidate > 0) await refundChargeByKey({ userId: Number(userId), chargeKey: chargeKey(id), refundKey: `${chargeKey(id)}/refund`, reason: "封面候选未交付退还积分", actionForLog: "platformTopicImages" }); },
    generate: async direction => {
      const result = await runPlatformTopicImagePipeline({
        viralCreation: source.viralCreation, topicHook: source.topicHook, context: source.context, format: source.format,
        sceneId, appealHook: source.appealHook, coverSubline: source.coverSubline, coverNativePlatform: source.coverNativePlatform,
        coverHeadlineFromVariant: source.coverHeadlineFromVariant, coverPersonaContext: input.params.coverPersonaContext,
        referencePhotoUrl: input.params.referencePhotoUrl, creationIdOut: null, isFreeRetry: false, newJobMetaBase: {},
        coverDesignInstruction: direction,
        // 独立任务的回执由本模块严格保存，避免旧进度写入覆盖三候选检查点。
      });
      if (!result.success || !result.imageUrl) throw new Error("封面生成未返回图片");
      return gsUriFromSignedGcsUrl(result.imageUrl) || result.imageUrl;
    },
    grade: (url, style) => postProcessPlatformCover(url, Number(userId), style, Boolean(input.params.referencePhotoUrl)),
  });
  return { provider: "vertex", output: { coverCandidateSet: set, success: set.candidates.some(c => c.status === "ready"), imageUrl: null, url: null } };
}
