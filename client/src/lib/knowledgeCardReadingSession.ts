import { z } from "zod";
import { knowledgeCardReadingPlanSchema, knowledgeCardReadingConstraintsSchema } from "@shared/knowledgeCardReadingPlan";
import { KNOWLEDGE_CARD_ACTIVE_DISTILL_MODELS } from "@shared/knowledgeCardDistillModels";

const pageSchema = z.object({ pageId: z.string().min(1), ordinal: z.number().int().positive(), title: z.string().min(1), contentMarkdown: z.string().min(1), visualDirections: z.string().min(1), referencePageIds: z.array(z.string()), imageGsUris: z.array(z.string()) });
export const readingSessionSchema = z.object({
  version: z.literal(1), id: z.string().min(1), userId: z.number().int().positive(),
  model: z.enum(KNOWLEDGE_CARD_ACTIVE_DISTILL_MODELS),
  files: z.array(z.object({ gcsUri: z.string().min(1), mimeType: z.string().min(1), fileName: z.string() })).min(1),
  constraints: knowledgeCardReadingConstraintsSchema,
  chargeDistillFee: z.boolean().optional(), distillFeeCharged: z.number().int().nonnegative().optional(),
  phase: z.enum(["idle", "reading", "planning", "ready", "generating", "failed"]),
  selectedMode: z.enum(["concise", "balanced", "complete"]),
  planId: z.string().optional(), plan: knowledgeCardReadingPlanSchema.optional(),
  readingJobId: z.string().optional(), editionJobId: z.string().optional(),
  pending: z.enum(["reading", "edition", "page"]).optional(),
  edition: z.object({ editionId: z.string(), planId: z.string(), mode: z.enum(["concise", "balanced", "complete"]), model: z.enum(KNOWLEDGE_CARD_ACTIVE_DISTILL_MODELS), pages: z.array(pageSchema).min(4), credits: z.number().int().nonnegative() }).optional(),
  pageTasks: z.record(z.string(), z.object({ attempt: z.number().int().min(0).max(100), status: z.enum(["pending", "succeeded", "failed"]), progressJobId: z.string().optional(), imageUrl: z.string().trim().min(1).optional(), error: z.string().optional(), infographicTemplateId: z.string().optional(), subjectPosition: z.enum(["left", "center"]) })),
  previousImages: z.array(z.string()).optional(),
  progress: z.object({ done: z.number(), total: z.number(), stage: z.string().optional(), jobStatus: z.string().optional(),
    updatedAt: z.string().datetime({ offset: true }).optional(), heartbeatAt: z.string().datetime({ offset: true }).optional() }).optional(),
  jobStatus: z.string().optional(), error: z.string().optional(),
}).superRefine((session, ctx) => {
  for (const [pageId, task] of Object.entries(session.pageTasks)) {
    if (task.status === "succeeded" && !task.imageUrl) ctx.addIssue({ code: "custom", path: ["pageTasks", pageId], message: "成功页面缺少图片，不能跳过生成" });
  }
  if (session.plan && session.plan.model !== session.model) ctx.addIssue({ code: "custom", path: ["plan"], message: "方案档位与阅读材料不一致" });
  if (session.edition) {
    if (session.edition.model !== session.model || session.edition.mode !== session.selectedMode || session.edition.planId !== session.planId) ctx.addIssue({ code: "custom", path: ["edition"], message: "逐页稿与已确认方案不一致" });
    const pages = session.edition.pages;
    if (new Set(pages.map(page => page.pageId)).size !== pages.length || [...pages].sort((a, b) => a.ordinal - b.ordinal).some((page, index) => page.ordinal !== index + 1)) ctx.addIssue({ code: "custom", path: ["edition", "pages"], message: "版次页码或页面编号不完整" });
  }
});
export type KnowledgeCardReadingSession = z.infer<typeof readingSessionSchema>;
export function readingSessionKey(userId: number) { return `mvs-knowledge-card-reading/u${userId}`; }
export function saveReadingSession(storage: Pick<Storage, "setItem">, session: KnowledgeCardReadingSession) {
  const checked = readingSessionSchema.parse(session);
  const raw = JSON.stringify(checked);
  storage.setItem(`${readingSessionKey(checked.userId)}/history/${checked.id}`, raw);
  storage.setItem(readingSessionKey(checked.userId), raw);
  return checked;
}
export function loadReadingSession(storage: Pick<Storage, "getItem">, userId: number) {
  const raw = storage.getItem(readingSessionKey(userId));
  if (!raw) return null;
  const session = readingSessionSchema.parse(JSON.parse(raw));
  if (session.userId !== userId) throw new Error("材料不属于当前账号");
  return session;
}
export function readingEditionImages(session: KnowledgeCardReadingSession) {
  return [...(session.edition?.pages ?? [])].sort((a, b) => a.ordinal - b.ordinal).flatMap(page => {
    const task = session.pageTasks[page.pageId];
    return task?.status === "succeeded" && task.imageUrl ? [task.imageUrl] : [];
  });
}
export function listReadingSessions(storage: Pick<Storage, "length" | "key" | "getItem">, userId: number) {
  const prefix = `${readingSessionKey(userId)}/history/`;
  const sessions: KnowledgeCardReadingSession[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const raw = storage.getItem(key);
    if (!raw) continue;
    const session = readingSessionSchema.parse(JSON.parse(raw));
    if (session.userId !== userId) throw new Error("历史材料不属于当前账号");
    sessions.push(session);
  }
  return sessions;
}
