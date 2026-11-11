import { z } from "zod";
import { completedKnowledgeBatches } from "../../shared/knowledgePublicationParallel";
import { knowledgePublicationPublicError } from "../../shared/knowledgePublicationPublic";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { knowledgeTimingLog } from "../services/knowledgePublicationCache";
import { layoutLibrarySchema } from "../../shared/editableLayout";
import {
  LayoutConflict,
  readLayoutLibrary,
  writeLayoutLibrary,
} from "../services/editableLayoutStore";
const publicationProcedure = protectedProcedure.use(async ({ next, path }) => {
  const startedAt = Date.now();
  const result = await next();
  // 每个图文手册接口一行耗时（不含正文与地址），用于定位阶段间空档。
  // 导出状态轮询（每 3 秒）成功时不逐条记，避免刷屏；任务本身另有 knowledgeExport.task 耗时日志。
  if (!(result.ok && path.endsWith("exportPublicationStatus"))) knowledgeTimingLog(path, startedAt, { ok: result.ok });
  if (!result.ok) {
    // 前台只收到业务提示；真实原因留在服务端日志（去地址、截断），否则出错后后台无从查起。
    const cause = result.error.cause instanceof Error ? result.error.cause.message : result.error.message;
    console.warn(`[knowledgePublication] ${path} failed code=${result.error.code} reason=${String(cause).replace(/(?:https?|gs):\/\/\S+/g, "[地址]").slice(0, 300)}`);
    return { ...result, error: new TRPCError({ code: result.error.code, message: knowledgePublicationPublicError(result.error).message }) };
  }
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
    // 同一云稿版本复用解析结果（顾问整册排版发车前也读同一份）。
    const book=await loadKnowledgeBookLayoutInput(ctx.user.id,input.documentId,{},{cache:true});
    return {sourceDigest:book.sourceDigest,chapters:book.pages.length,images:book.pages.filter(p=>p.hasImage).length};
  }),
  bookLayoutPreview: publicationProcedure.input(z.object({documentId:z.string().uuid()}).strict()).query(async({ctx,input})=>{
    const {currentLayoutGeneration}=await import("../services/editableLayoutStore");
    const {loadKnowledgeBookLayoutView}=await import("../services/knowledgeBookLayout");
    const {signGsUriV4ReadUrl}=await import("../services/gcs");
    const generation=await currentLayoutGeneration(ctx.user.id);
    // 与导出共用同一 generation 的整册视图缓存；签名地址每次现签，不进缓存。
    const view=await loadKnowledgeBookLayoutView(ctx.user.id,input.documentId,generation,{},{cache:true});
    const images=Object.fromEntries(view.doc.pages.filter(p=>p.imageUrl).map(p=>[p.imageUrl,signGsUriV4ReadUrl(p.imageUrl,3600)]));
    return {doc:view.doc,review:view.review,images,generation};
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
  /** 导出不阻塞：发起即返回任务标识，后台执行；同一账号+稿件+版本重复发起复用同一任务（刷新后重新发起即可续看）。 */
  startExportPublication: publicationProcedure.input(z.object({documentId:z.string().uuid(),expectedGeneration:z.string().regex(/^\d+$/)}).strict())
    .mutation(async({ctx,input})=>{
      const {knowledgeExportTasks}=await import("../services/knowledgePublicationExportTasks");
      return knowledgeExportTasks().start(ctx.user.id,input.documentId,input.expectedGeneration);
    }),
  exportPublicationStatus: publicationProcedure.input(z.object({taskId:z.string().regex(/^[a-f0-9]{32}$/)}).strict()).query(async({ctx,input})=>{
    const {knowledgeExportTasks}=await import("../services/knowledgePublicationExportTasks");
    // 未知任务（含服务重启后）返回 missing，由前台用同一稿件版本重新发起，已完成分片复用。
    return knowledgeExportTasks().status(ctx.user.id,input.taskId)??{status:"missing" as const,taskId:input.taskId};
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
      const startedAt = Date.now();
      try {
        const saved = await writeLayoutLibrary(
          ctx.user.id,
          input.library,
          input.expectedGeneration
        );
        knowledgeTimingLog("editableLayout.save", startedAt, { ok: true, documents: input.library.documents.length });
        return saved;
      } catch (e) {
        knowledgeTimingLog("editableLayout.save", startedAt, { ok: false, documents: input.library.documents.length });
        throw new TRPCError({
          code:
            e instanceof LayoutConflict ? "CONFLICT" : "SERVICE_UNAVAILABLE",
          message: e instanceof Error ? e.message : "排版稿保存失败",
        });
      }
    }),
});
