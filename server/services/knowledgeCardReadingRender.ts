import { z } from "zod";
import { loadKnowledgeCardReadingEdition } from "./knowledgeCardReadingEdition.js";
import { knowledgeReadingDigest, knowledgeReadingPrefix, readKnowledgeReadingJson, saveKnowledgeReadingObject, claimKnowledgeReadingCall } from "./knowledgeCardReadingStore.js";
import { getJobByIdStrict } from "../jobs/repository.js";
import { resolveKnowledgeCardSubjectPosition, KNOWLEDGE_CARD_SUBJECT_POSITIONS } from "../../shared/knowledgeCardSubjectPosition.js";
import { knowledgeCardCreditsForPageIndex } from "../../shared/knowledgeCardPagination.js";
import { signGsUriV4ReadUrl } from "./gcs.js";
import { refreshManhuaDraftSignedUrls } from "./manhuaDraftUrlRefresh.js";

export const knowledgeCardReadingPageReferenceSchema = z.object({
  editionId: z.string().regex(/^[a-f0-9]{64}$/), pageId: z.string().min(1).max(128),
  attempt: z.number().int().min(0).max(100).optional(),
}).strict();
export const knowledgeCardReadingRenderRequestSchema = knowledgeCardReadingPageReferenceSchema.extend({
  infographicTemplateId: z.string().max(64).optional(), subjectPosition: z.enum(KNOWLEDGE_CARD_SUBJECT_POSITIONS).optional(),
}).strict();
export type KnowledgeCardReadingRenderRequest = z.infer<typeof knowledgeCardReadingRenderRequestSchema>;
export type ReadingRenderOutcome = { progressJobId: string; status: "succeeded"; imageUrl: string };

export async function resolveKnowledgeCardReadingRender(userId: number, raw: KnowledgeCardReadingRenderRequest) {
  const input = knowledgeCardReadingRenderRequestSchema.parse(raw);
  const edition = await loadKnowledgeCardReadingEdition(userId, input.editionId);
  const page = edition.pages.find(candidate => candidate.pageId === input.pageId);
  if (!page) throw new Error("所选页面不属于已确认方案");
  const { configuration, renderId, prefix, progressJobId } = knowledgeCardReadingRenderIdentity(userId, input);
  const cost = knowledgeCardCreditsForPageIndex(page.ordinal, edition.model);
  return { edition, page, configuration, renderId, prefix, progressJobId, cost };
}
export function knowledgeCardReadingRenderIdentity(userId: number, raw: KnowledgeCardReadingRenderRequest) {
  const input = knowledgeCardReadingRenderRequestSchema.parse(raw);
  const configuration = { editionId: input.editionId, pageId: input.pageId, attempt: input.attempt || 0,
    infographicTemplateId: input.infographicTemplateId || "", subjectPosition: resolveKnowledgeCardSubjectPosition(input.subjectPosition) };
  const renderId = knowledgeReadingDigest(JSON.stringify(configuration));
  return { configuration, renderId, prefix: `${knowledgeReadingPrefix(userId)}renders/${renderId}`, progressJobId: `kcp_${renderId.slice(0, 48)}` };
}
export type ResolvedKnowledgeCardReadingRender = Awaited<ReturnType<typeof resolveKnowledgeCardReadingRender>>;

export async function getKnowledgeCardReadingRenderStatus(userId: number, input: KnowledgeCardReadingRenderRequest) {
  const resolved = knowledgeCardReadingRenderIdentity(userId, input);
  const result = await readKnowledgeReadingJson<ReadingRenderOutcome>(`${resolved.prefix}/result.json`);
  if (result) {
    if (result.progressJobId !== resolved.progressJobId || result.status !== "succeeded" || !result.imageUrl) throw new Error("生成结果与页面身份不一致");
    return refreshManhuaDraftSignedUrls(result).payload;
  }
  const failure = await readKnowledgeReadingJson<{ progressJobId: string; status: "failed" | "reconcile"; error: string }>(`${resolved.prefix}/failure.json`);
  if (failure) {
    if (failure.progressJobId !== resolved.progressJobId || !["failed", "reconcile"].includes(failure.status)) throw new Error("页面失败回执身份不一致");
    if (failure.status === "reconcile") {
      const recovered = await getJobByIdStrict(resolved.progressJobId);
      if (recovered && recovered.userId !== String(userId)) throw new Error("任务归属不一致");
      const output = recovered?.output as { compositeImageUrl?: string; imageUrl?: string } | null;
      const imageUrl = output?.compositeImageUrl || output?.imageUrl;
      if (recovered?.status === "succeeded" && imageUrl?.trim()) return refreshManhuaDraftSignedUrls({ progressJobId: resolved.progressJobId, status: "succeeded" as const, imageUrl }).payload;
    }
    return { ...failure, imageUrl: undefined };
  }
  const job = await getJobByIdStrict(resolved.progressJobId);
  if (job) {
    if (job.userId !== String(userId)) throw new Error("任务归属不一致");
    const output = job.output as { compositeImageUrl?: string; imageUrl?: string } | null;
    // 通用任务清理只知道超时；只有独立失败回执才能证明未扣款或已退款。
    if (job.status === "failed") return { progressJobId: resolved.progressJobId, status: "reconcile" as const, imageUrl: undefined, error: "原任务已中断，但生成与费用尚未核对，请查询原任务，不能重复购买" };
    return refreshManhuaDraftSignedUrls({ progressJobId: resolved.progressJobId, status: job.status, imageUrl: output?.compositeImageUrl || output?.imageUrl, error: job.error || undefined }).payload;
  }
  const claim = await readKnowledgeReadingJson<unknown>(`${resolved.prefix}/claim.json`);
  return { progressJobId: resolved.progressJobId, status: claim ? "starting" as const : "not_started" as const, imageUrl: undefined, error: claim ? "页面请求正在初始化或等待对账，请查询原任务，不要重复购买" : undefined };
}

/** 费用检查后、实际扣费前原子占用，跨请求和跨设备只提交同一个页面任务。 */
export async function claimKnowledgeCardReadingRender(userId: number, resolved: ResolvedKnowledgeCardReadingRender) {
  if (resolved.configuration.attempt > 0) {
    const previous = await getKnowledgeCardReadingRenderStatus(userId, { ...resolved.configuration, attempt: resolved.configuration.attempt - 1 });
    if (previous.status !== "failed") throw new Error("上一笔页面任务尚未确认失败，不能重复生成");
  }
  return claimKnowledgeReadingCall(`${resolved.prefix}/claim.json`);
}

export function knowledgeCardFrozenPageForRender(resolved: ResolvedKnowledgeCardReadingRender) {
  return {
    pageId: resolved.page.pageId, contentMarkdown: resolved.page.contentMarkdown,
    visualDirections: resolved.page.visualDirections, sourcePageIds: resolved.page.sourcePageIds,
    referenceImageUrls: resolved.page.imageGsUris.map(uri => signGsUriV4ReadUrl(uri, 3600)),
  };
}

export async function saveKnowledgeCardReadingRenderResult(resolved: ResolvedKnowledgeCardReadingRender, imageUrl: string) {
  if (!imageUrl.trim()) throw new Error("页面图片为空，不能登记完成");
  const result: ReadingRenderOutcome = { progressJobId: resolved.progressJobId, status: "succeeded", imageUrl };
  await saveKnowledgeReadingObject(`${resolved.prefix}/result.json`, Buffer.from(JSON.stringify(result)));
}

/** 已知未扣费或已完成退款才允许新attempt；扣费结果未知保留对账态，不能把异常当成没扣款。 */
export async function saveKnowledgeCardReadingRenderFailure(resolved: ResolvedKnowledgeCardReadingRender, error: unknown, safeToRetry: boolean) {
  await saveKnowledgeReadingObject(`${resolved.prefix}/failure.json`, Buffer.from(JSON.stringify({
    progressJobId: resolved.progressJobId, status: safeToRetry ? "failed" : "reconcile",
    error: safeToRetry ? String(error instanceof Error ? error.message : error) : "页面初始化或费用结果尚未确认，已保留原任务，请等待对账，未重复生成",
  })));
}
