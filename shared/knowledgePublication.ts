import {knowledgePresentationRequestSchema,knowledgePresentationPlanSchema} from "./knowledgePresentation";
import { knowledgeCitationSchema } from "./knowledgeResearch";
import { z } from "zod";
import { knowledgeReadingSchema } from "./knowledgePublicationLayout";

/** 知识卡专用合同；学习报告只提供视觉参考，不携带剧情、镜头或音轨字段。 */
export const knowledgePublicationContextSchema = z
  .object({
    documentId: z.string().uuid(),
    batchIndex: z.number().int().min(0),
    purpose: z.literal("presentation").optional(),
    attempt: z.number().int().min(0).max(65535).default(0),
  })
  .strict();
export type KnowledgePublicationContext = z.infer<
  typeof knowledgePublicationContextSchema
>;
export const knowledgeSourcePageSchema = z
  .object({
    id: z.string().uuid(),
    headline: z.string().max(500),
    body: z.string().max(50000),
    imageUrl: z.string().max(6000),
  })
  .strict();
export const knowledgeSourceSchema = z
  .object({
    title: z.string().min(1).max(500),
    detailLevel: z.enum(["concise", "full"]).optional(),
    pages: z.array(knowledgeSourcePageSchema).min(1),
  })
  .strict()
  .superRefine((source, ctx) => {
    if (new Set(source.pages.map(p => p.id)).size !== source.pages.length)
      ctx.addIssue({ code: "custom", message: "知识卡页编号重复" });
  });
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;
export const knowledgeReviewPageSchema = z
  .object({
    id: z.string().uuid(),
    headline: z.string().trim().min(1).max(500),
    body: z.string().trim().min(1).max(12000),
    reading: knowledgeReadingSchema.optional(),
    sources: z.array(knowledgeCitationSchema).max(12).optional(),
    imageDescription: z.string().trim().max(1500),
    imageStatus: z.enum(["consistent", "conflict", "uncertain", "absent"]),
    facts: z
      .array(
        z
          .object({
            term: z.string().trim().min(1).max(200),
            statement: z.string().trim().min(1).max(1500),
          })
          .strict()
      )
      .min(1),
    cautions: z
      .array(
        z
          .object({
            kind: z.enum(["image_text", "text", "uncertain"]),
            evidence: z.string().trim().min(1).max(2000),
            message: z.string().trim().min(1).max(2000),
          })
          .strict()
      ),
  })
  .strict();
export const knowledgeReviewSchema = z
  .object({
    kind: z.literal("knowledge_publication_v1"),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    title: z.string().trim().min(1).max(500),
    pages: z.array(knowledgeReviewPageSchema).min(1),
  })
  .strict();
export type KnowledgeReview = z.infer<typeof knowledgeReviewSchema>;
export const knowledgePublicationSchema = z
  .object({
    version: z.literal(1),
    requestId: z.string().uuid(),
    infographicTemplateId: z.string().max(100).optional(),
    source: knowledgeSourceSchema,
    review: knowledgeReviewSchema.optional(),
    completedBatches: z.number().int().min(0).default(0),
    attempts: z
      .record(z.string(), z.number().int().min(0).max(65535))
      .default({}),
    manuscript: z.string(),
    confirmedManuscript: z.string().optional(),
    presentationRequest: knowledgePresentationRequestSchema.optional(),
    presentationPlan: knowledgePresentationPlanSchema.optional(),
    presentationRevision: knowledgePresentationPlanSchema.optional(),
  })
  .strict();
export type KnowledgePublication = z.infer<typeof knowledgePublicationSchema>;

export function validateKnowledgeReview(
  value: unknown,
  source: KnowledgeSource,
  digest: string
): KnowledgeReview {
  const review = knowledgeReviewSchema.parse(value);
  if (
    review.sourceDigest !== digest ||
    review.pages.length !== source.pages.length ||
    review.pages.some((p, i) => p.id !== source.pages[i].id)
  )
    throw new Error("审校结果与原稿页号不一致，原稿已保留");
  for (const [i, page] of Array.from(review.pages.entries())) {
    const hasImage = Boolean(source.pages[i].imageUrl);
    if (
      hasImage === (page.imageStatus === "absent") ||
      (hasImage && !page.imageDescription.trim())
    )
      throw new Error(`第${i + 1}页缺少实际配图审校，未采用结果`);
    if (
      ["conflict", "uncertain"].includes(page.imageStatus) &&
      !page.cautions.length
    )
      throw new Error(`第${i + 1}页的图文疑点没有说明，未采用结果`);
  }
  return review;
}

/** 一个文本框；页标只负责稳定绑定配图，不让用户编辑内部编号。 */
export function knowledgeManuscript(source: {
  title: string;
  pages: { headline: string; body: string }[];
}): string {
  return (
    `# ${source.title}\n\n` +
    source.pages
      .map(
        (p, i) =>
          `## ${String(i + 1).padStart(2, "0")}｜${p.headline}\n\n${p.body}`
      )
      .join("\n\n")
  );
}
export function parseKnowledgeManuscript(
  text: string,
  pageIds: readonly string[]
) {
  const title = text.match(/^# ([^\n]+)\n/)?.[1]?.trim();
  const markers = Array.from(text.matchAll(/^## (\d{2,})｜([^\n]+)\n/gm));
  if (
    !title ||
    title.length > 500 ||
    markers.length !== pageIds.length ||
    markers.some((m, i) => Number(m[1]) !== i + 1)
  )
    throw new Error("请保留总标题和各页编号，以便说明与配图一一对应");
  if (text.slice(text.indexOf("\n") + 1, markers[0].index).trim())
    throw new Error("请把正文放在对应页标题下，避免导出遗漏");
  const pages = markers.map((m, i) => {
    const body = text
      .slice(m.index! + m[0].length, markers[i + 1]?.index ?? text.length)
      .trim();
    if (!body || body.length > 12000 || m[2].length > 500)
      throw new Error(`第${i + 1}页正文为空或过长，请核对后确认`);
    return { id: pageIds[i], headline: m[2].trim(), body };
  });
  return { title, pages };
}

export const KNOWLEDGE_PUBLICATION_QUESTION =
  "检查这套知识卡的实际配图、文字说明及前后内容是否矛盾，整理为主题清楚、表达流畅的图文阅读稿。保留原有知识主题与重要事实，不采用剧情学习报告内容。";

/** 自动按图片数与文字量分批；只影响内部任务，用户不必手动拆页。 */
export function knowledgeReviewBatches(source: KnowledgeSource): number[][] {
  const batches: number[][] = [];
  let current: number[] = [];
  let chars = 0;
  for (const [i, page] of Array.from(source.pages.entries())) {
    if (
      current.length &&
      (current.length >= 4 || chars + page.body.length > 24000)
    ) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(i);
    chars += page.body.length;
  }
  if (current.length) batches.push(current);
  return batches;
}
/** 同一页批/同一次失败重试固定一个事务编号；刷新、断线不产生新编号。 */
export function knowledgeBatchRequestId(
  root: string,
  batchIndex: number,
  attempt = 0
): string {
  z.string().uuid().parse(root);
  if (
    !Number.isSafeInteger(batchIndex) ||
    batchIndex < 0 ||
    !Number.isSafeInteger(attempt) ||
    attempt < 0 ||
    attempt > 65535
  )
    throw new Error("审校批次编号无效");
  const tail =
    (BigInt("0x" + root.slice(-12)) +
      BigInt(batchIndex) * BigInt(65536) +
      BigInt(attempt)) %
    BigInt("0x1000000000000");
  return root.slice(0, -12) + tail.toString(16).padStart(12, "0");
}
export const knowledgeBatchResultSchema = z
  .object({
    kind: z.literal("knowledge_publication_batch_v1"),
    batchIndex: z.number().int().min(0),
    batchCount: z.number().int().positive(),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    reviewedPages: z.array(z.string().uuid()),
  })
  .strict();

export const knowledgeConsistencyBatchResultSchema = z.object({
  kind:z.literal("knowledge_consistency_batch_v1"),batchIndex:z.number().int().min(0),batchCount:z.number().int().positive(),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
