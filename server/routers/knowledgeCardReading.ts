import { resumeKnowledgeCardReadingJob } from "../services/knowledgeCardReadingResume.js";
import { knowledgeCardReadingRenderRequestSchema, getKnowledgeCardReadingRenderStatus } from "../services/knowledgeCardReadingRender.js";
import { z } from "zod";
import { protectedProcedure } from "../_core/trpc.js";
import { createJob, getJobByIdStrict } from "../jobs/repository.js";
import { KNOWLEDGE_CARD_ACTIVE_DISTILL_MODELS } from "../../shared/knowledgeCardDistillModels.js";
import { knowledgeCardReadingConstraintsSchema, KNOWLEDGE_CARD_READING_MODES } from "../../shared/knowledgeCardReadingPlan.js";
import { resolveKnowledgeReadingSources, knowledgeReadingInputId } from "../services/knowledgeCardReading.js";
import { knowledgeReadingDigest } from "../services/knowledgeCardReadingStore.js";

async function createReadingJobOnce(userId: number, id: string, action: string, params: unknown) {
  const existing = await getJobByIdStrict(id);
  if (existing) {
    if (existing.userId !== String(userId)) throw new Error("任务不属于当前账号");
    return { progressJobId: id, status: existing.status };
  }
  try {
    await createJob({ id, userId: String(userId), type: "platform", provider: "evolink", input: { action, params } });
  } catch (error) {
    const concurrent = await getJobByIdStrict(id);
    if (!concurrent || concurrent.userId !== String(userId)) throw error;
    return { progressJobId: id, status: concurrent.status };
  }
  return { progressJobId: id, status: "queued" as const };
}

export const knowledgeCardReadingProcedures = {
  resumeKnowledgeCardReadingJob: protectedProcedure.input(z.object({ progressJobId: z.string().regex(/^kc[re]_[a-f0-9]{48}$/) }).strict()).mutation(({ctx,input}) => resumeKnowledgeCardReadingJob(ctx.user.id,input.progressJobId)),
  getKnowledgeCardReadingPageStatus: protectedProcedure.input(knowledgeCardReadingRenderRequestSchema).query(({ctx,input}) => getKnowledgeCardReadingRenderStatus(ctx.user.id,input)),
  prepareKnowledgeCardReading: protectedProcedure.input(z.object({
    model: z.enum(KNOWLEDGE_CARD_ACTIVE_DISTILL_MODELS),
    files: z.array(z.object({ gcsUri: z.string().min(1).max(2048), mimeType: z.string().min(1).max(120), fileName: z.string().max(240).optional() }).strict()).min(1).max(40),
    constraints: knowledgeCardReadingConstraintsSchema.optional(),
    chargeDistillFee: z.boolean().optional(),
  }).strict()).mutation(async ({ ctx, input }) => {
    const files = await resolveKnowledgeReadingSources(ctx.user.id, input.files);
    const constraints = knowledgeCardReadingConstraintsSchema.parse(input.constraints || {});
    const source = { userId: ctx.user.id, model: input.model, files };
    const id = `kcr_${knowledgeReadingDigest(knowledgeReadingInputId(source) + JSON.stringify(constraints)).slice(0, 48)}`;
    return createReadingJobOnce(ctx.user.id, id, "knowledge_card_reading", { model: input.model, files, constraints, chargeDistillFee: input.chargeDistillFee === true });
  }),
  getKnowledgeCardReadingPlan: protectedProcedure.input(z.object({ planId: z.string().regex(/^[a-f0-9]{64}-[a-f0-9]{64}$/) }).strict()).query(async ({ ctx, input }) => {
    const { loadKnowledgeCardReadingPlan } = await import("../services/knowledgeCardReadingEdition.js");
    const loaded = await loadKnowledgeCardReadingPlan(ctx.user.id, input.planId);
    return { planId: input.planId, plan: loaded.plan, constraints: loaded.constraints, quote: loaded.quote, sourcePages: loaded.analysis.pages.length };
  }),
  prepareKnowledgeCardReadingEdition: protectedProcedure.input(z.object({
    planId: z.string().regex(/^[a-f0-9]{64}-[a-f0-9]{64}$/), mode: z.enum(KNOWLEDGE_CARD_READING_MODES),
  }).strict()).mutation(async ({ ctx, input }) => {
    const { loadKnowledgeCardReadingPlan } = await import("../services/knowledgeCardReadingEdition.js");
    const loaded = await loadKnowledgeCardReadingPlan(ctx.user.id, input.planId);
    if (!loaded.quote.options.find(option => option.mode === input.mode)?.selectable) throw new Error("此方案不满足预算或目标页数，请重新规划后选择");
    const id = `kce_${knowledgeReadingDigest(JSON.stringify({ userId: ctx.user.id, ...input })).slice(0, 48)}`;
    return createReadingJobOnce(ctx.user.id, id, "knowledge_card_edition", input);
  }),
};
