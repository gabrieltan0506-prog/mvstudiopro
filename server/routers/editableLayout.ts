import { z } from "zod";
import { completedKnowledgeBatches } from "../../shared/knowledgePublicationParallel";
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
  readingPreparation: publicationProcedure.input(z.object({jobId:z.string().regex(/^kc_[a-zA-Z0-9_-]+$/)}).strict()).query(async({ctx,input})=>{
    const {knowledgeReadingPreparationState}=await import("../services/knowledgeReadingPreparation");
    const {resolvePlatformSkillQaPaidCredits}=await import("../config/platformSwitches");
    const state=await knowledgeReadingPreparationState(ctx.user.id,input.jobId);
    const remaining=Math.max(0,state.batches-state.completed.length),paidUnit=resolvePlatformSkillQaPaidCredits("terra");
    return {...state,paidUnit,maxCredits:0,estimatedCredits:0};
  }),

  bookLayoutInput: publicationProcedure.input(z.object({documentId:z.string().uuid()}).strict()).query(async({ctx,input})=>{
    const {loadKnowledgeBookLayoutInput}=await import("../services/knowledgeBookLayout");
    const book=await loadKnowledgeBookLayoutInput(ctx.user.id,input.documentId);
    return {sourceDigest:book.sourceDigest,chapters:book.pages.length,images:book.pages.filter(p=>p.hasImage).length};
  }),
  bookLayoutPreview: publicationProcedure.input(z.object({documentId:z.string().uuid()}).strict()).query(async({ctx,input})=>{
    const {readCanonicalLayoutLibrary}=await import("../services/editableLayoutStore");
    const {loadKnowledgeBookLayoutView}=await import("../services/knowledgeBookLayout");
    const {signGsUriV4ReadUrl}=await import("../services/gcs");
    const loaded=await readCanonicalLayoutLibrary(ctx.user.id);
    const view=await loadKnowledgeBookLayoutView(ctx.user.id,input.documentId,loaded.generation,{load:async()=>loaded});
    const images=Object.fromEntries(view.doc.pages.filter(p=>p.imageUrl).map(p=>[p.imageUrl,signGsUriV4ReadUrl(p.imageUrl,3600)]));
    return {doc:view.doc,review:view.review,images};
  }),
  conversationRetry: publicationProcedure.input(z.object({documentId:z.string().uuid(),failedRequestId:z.string().uuid()}).strict()).query(async({ctx,input})=>{
    const {readCanonicalLayoutLibrary}=await import('../services/editableLayoutStore');
    const {checkKnowledgeConversationRetry}=await import('../services/knowledgeConversationRetry');
    const loaded=await readCanonicalLayoutLibrary(ctx.user.id);
    const doc=loaded.library?.documents.find(d=>d.id===input.documentId);
    if(!doc)throw Error('排版稿不存在或无权访问');
    return checkKnowledgeConversationRetry(ctx.user.id,doc,input.failedRequestId);
  }),
  presentationRetry: publicationProcedure.input(z.object({documentId:z.string().uuid(),failedRequestId:z.string().uuid()}).strict()).query(async({ctx,input})=>{
    const {readCanonicalLayoutLibrary}=await import('../services/editableLayoutStore');
    const {checkKnowledgePresentationRetry}=await import('../services/knowledgePresentationRetry');
    const loaded=await readCanonicalLayoutLibrary(ctx.user.id);
    const doc=loaded.library?.documents.find(d=>d.id===input.documentId);
    if(!doc)throw Error('排版稿不存在或无权访问');
    return checkKnowledgePresentationRetry(ctx.user.id,doc,input.failedRequestId);
  }),
  publicationQuote: publicationProcedure.input(z.object({documentId:z.string().uuid(),purpose:z.enum(["presentation","conversation"]).optional()}).strict()).query(async({ctx,input})=>{
    const {loadKnowledgePublication,knowledgePublicationWorkPlan}=await import("../services/knowledgePublicationAdvisor");
    const {knowledgeReviewBatches}=await import("../../shared/knowledgePublication");
    const {resolvePlatformSkillQaPaidCredits}=await import("../config/platformSwitches");
    const doc=await loadKnowledgePublication(ctx.user.id,{documentId:input.documentId,batchIndex:0,attempt:0});
    const plan=input.purpose?{totalBatches:1,reviewBatches:0,consistencyKnown:true}:await knowledgePublicationWorkPlan(ctx.user.id,doc);
    const batches=plan.totalBatches;
    const completed = doc.publication.completedBatches >= plan.reviewBatches ? doc.publication.completedBatches : completedKnowledgeBatches(doc.publication, plan.reviewBatches).size;
    const remaining=input.purpose?1:doc.publication.review?0:Math.max(0,batches-completed);
    const paidUnit=resolvePlatformSkillQaPaidCredits("terra");
    return {batches,remaining,reviewBatches:plan.reviewBatches,consistencyKnown:plan.consistencyKnown,paidUnit,maxCredits:0,estimatedCredits:0,freeBatches:remaining};
  }),
  exportPublication: publicationProcedure.input(z.object({documentId:z.string().uuid(),expectedGeneration:z.string().regex(/^\d+$/)}).strict())
    .mutation(async({ctx,input})=>{
      const {exportKnowledgePublication}=await import("../services/knowledgePublicationExport");
      return exportKnowledgePublication(ctx.user.id,input.documentId,input.expectedGeneration);
    }),
  exportPublicationPptx: publicationProcedure.input(z.object({documentId:z.string().uuid(),expectedGeneration:z.string().regex(/^\d+$/)}).strict())
    .mutation(async({ctx,input})=>{
      const {exportKnowledgePublicationPptx}=await import("../services/knowledgePublicationPptx");
      return exportKnowledgePublicationPptx(ctx.user.id,input.documentId,input.expectedGeneration);
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
