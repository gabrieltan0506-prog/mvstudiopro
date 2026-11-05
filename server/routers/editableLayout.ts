import { z } from "zod";
import { knowledgePublicationPublicError } from "../../shared/knowledgePublicationPublic";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { layoutLibrarySchema } from "../../shared/editableLayout";
import {
  LayoutConflict,
  readLayoutLibrary,
  writeLayoutLibrary,
} from "../services/editableLayoutStore";
const publicationProcedure = protectedProcedure.use(async ({ next }) => {
  const result = await next();
  if (!result.ok) return { ...result, error: new TRPCError({ code: result.error.code, message: knowledgePublicationPublicError(result.error).message }) };
  return result;
});
export const editableLayoutRouter = router({
  publicationQuote: publicationProcedure.input(z.object({documentId:z.string().uuid()}).strict()).query(async({ctx,input})=>{
    const {loadKnowledgePublication,knowledgePublicationWorkPlan}=await import("../services/knowledgePublicationAdvisor");
    const {knowledgeReviewBatches}=await import("../../shared/knowledgePublication");
    const {resolvePlatformSkillQaPaidCredits}=await import("../config/platformSwitches");
    const {countPlatformSkillQaToday}=await import("../services/platformSkillQa");
    const {platformSkillQaDailyFreeLimit}=await import("../../shared/plans");
    const doc=await loadKnowledgePublication(ctx.user.id,{documentId:input.documentId,batchIndex:0,attempt:0});
    const plan=await knowledgePublicationWorkPlan(ctx.user.id,doc);
    const batches=plan.totalBatches;
    const remaining=doc.publication.review?0:Math.max(0,batches-doc.publication.completedBatches);
    const exempt=ctx.user.role==="admin"||ctx.user.role==="supervisor";
    const paidUnit=resolvePlatformSkillQaPaidCredits("terra");
    const free=exempt?remaining:Math.max(0,platformSkillQaDailyFreeLimit("terra")-await countPlatformSkillQaToday(ctx.user.id,"terra",false));
    return {batches,remaining,reviewBatches:plan.reviewBatches,consistencyKnown:plan.consistencyKnown,paidUnit,maxCredits:exempt?0:remaining*paidUnit,estimatedCredits:exempt?0:Math.max(0,remaining-free)*paidUnit,freeBatches:Math.min(free,remaining)};
  }),
  exportPublication: publicationProcedure.input(z.object({documentId:z.string().uuid(),expectedGeneration:z.string().regex(/^\d+$/)}).strict())
    .mutation(async({ctx,input})=>{
      const {exportKnowledgePublication}=await import("../services/knowledgePublicationExport");
      return exportKnowledgePublication(ctx.user.id,input.documentId,input.expectedGeneration);
    }),
  get: protectedProcedure.query(({ ctx }) => readLayoutLibrary(ctx.user.id)),
  save: protectedProcedure
    .input(
      z
        .object({
          library: layoutLibrarySchema,
          expectedGeneration: z.string().regex(/^\d+$/),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await writeLayoutLibrary(
          ctx.user.id,
          input.library,
          input.expectedGeneration
        );
      } catch (e) {
        throw new TRPCError({
          code:
            e instanceof LayoutConflict ? "CONFLICT" : "SERVICE_UNAVAILABLE",
          message: e instanceof Error ? e.message : "排版稿保存失败",
        });
      }
    }),
});
