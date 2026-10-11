import { codeMotionSpatialProductionInputSchema } from "../../shared/codeMotionSpatialProduction";
import { prepareCodeMotionSpatialProduction, submitCodeMotionSpatialProduction, getCodeMotionSpatialProduction, adoptCodeMotionSpatialProduction } from "../services/codeMotionSpatialProduction";
import { assertPaidSceneGenerationAccess } from "../services/paidSceneAccess";
import { codeMotionSpatialFrameSchema } from "../../shared/codeMotionSpatial";
import { loadCodeMotion } from "../services/codeMotionStore";
import { importCodeMotionSpatialAsset, importCodeMotionSpatialFrame, assertCodeMotionSpatial } from "../services/codeMotionSpatial";
import { importCodeMotionExistingVideo, listCodeMotionImportedVideos, adoptCodeMotionImportedVideo } from "../services/codeMotionVideoImport";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { signGsUriV4ReadUrl } from "../services/gcs";
import { inkSource } from "../services/inkFreeQuota";
import {
  ensureCodeMotionProductionGrant,
  getCodeMotionProductionGrant,
} from "../services/codeMotionProductionGrant";
import {
  prepareCodeMotionProductionVideo,
  submitCodeMotionProductionVideo,
  listCodeMotionProductionVideo,
  adoptCodeMotionProductionVideo,
} from "../services/codeMotionProductionVideo";
import {
  codeMotionRevisionInputSchema,
  quoteCodeMotionRevision,
  prepareCodeMotionRevision,
  submitCodeMotionRevision,
} from "../services/codeMotionRevision";
const project = z.object({ projectId: z.string().uuid() });
const version = project.extend({
  expectedGeneration: z.string().regex(/^\d+$/),
});
export const codeMotionProductionRouter = router({
  spatialPrepare: adminProcedure.input(codeMotionSpatialProductionInputSchema).mutation(({ctx,input})=>prepareCodeMotionSpatialProduction(String(ctx.user.id),input)),
  spatialSubmit: adminProcedure.input(z.object({request:codeMotionSpatialProductionInputSchema,confirmedFingerprint:z.string().regex(/^[a-f0-9]{64}$/)})).mutation(async({ctx,input})=>{
    await assertPaidSceneGenerationAccess(ctx.user);
    return submitCodeMotionSpatialProduction(String(ctx.user.id),{...input.request,confirmedFingerprint:input.confirmedFingerprint});
  }),
  spatialStatus: adminProcedure.input(project).query(({ctx,input})=>getCodeMotionSpatialProduction(String(ctx.user.id),input.projectId)),
  spatialAdopt: adminProcedure.input(project).mutation(({ctx,input})=>adoptCodeMotionSpatialProduction(String(ctx.user.id),input.projectId)),
  importedVideos: protectedProcedure.input(project).query(async({ctx,input})=>(await listCodeMotionImportedVideos(String(ctx.user.id),input.projectId)).map(r=>({...r,url:signGsUriV4ReadUrl(r.asset.videoUri,3600)}))),
  adoptImportedVideo: protectedProcedure.input(version.extend({sceneIndex:z.number().int().min(0).max(11),assetId:z.string().max(100)})).mutation(({ctx,input})=>adoptCodeMotionImportedVideo(String(ctx.user.id),input)),
  importSpatialAsset: protectedProcedure.input(project.extend({ name:z.string().min(1).max(160),kind:z.enum(["glb","spz"]),gcsUri:z.string().max(2048) })).mutation(({ctx,input})=>importCodeMotionSpatialAsset(String(ctx.user.id),input)),
  spatialPreviews: protectedProcedure.input(project).query(async({ctx,input})=>{
    const saved=await loadCodeMotion(String(ctx.user.id),input.projectId);
    const spatial=saved?.project.plan?.spatial;
    if (!spatial) return {assets:[],frames:[]};
    await assertCodeMotionSpatial(String(ctx.user.id),input.projectId,spatial);
    return {assets:spatial.assets.map(a=>({...a,url:signGsUriV4ReadUrl(a.gcsUri,3600)})),frames:spatial.frames.map(f=>({...f,url:signGsUriV4ReadUrl(f.image.gcsUri,3600)}))};
  }),
  importSpatialFrame: protectedProcedure.input(version.extend({gcsUri:z.string().max(2048),bytes:z.number().int().positive().max(8*1024*1024),frame:codeMotionSpatialFrameSchema.omit({id:true,image:true,sceneDigest:true})})).mutation(async({ctx,input})=>{
    const saved=await loadCodeMotion(String(ctx.user.id),input.projectId);
    if (!saved || saved.generation!==input.expectedGeneration) throw Error("作品已变化，请先保存再采用参考帧");
    return importCodeMotionSpatialFrame(String(ctx.user.id),saved.project,input);
  }),
  importExistingVideo: protectedProcedure.input(version.extend({sceneIndex:z.number().int().min(0).max(11),gcsUri:z.string().max(2048),name:z.string().min(1).max(160),sourceNote:z.string().max(500)})).mutation(({ctx,input})=>importCodeMotionExistingVideo(String(ctx.user.id),input)),
  revisionQuote: protectedProcedure
    .input(project)
    .query(({ ctx, input }) =>
      quoteCodeMotionRevision(String(ctx.user.id), input.projectId)
    ),
  revisionPrepare: protectedProcedure
    .input(codeMotionRevisionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const price = await prepareCodeMotionRevision(String(ctx.user.id), input);
      return {
        ...price,
        sourcePreviewUrl: price.shot.editSource
          ? signGsUriV4ReadUrl(price.shot.editSource.providerReference?.videoUri ?? price.shot.editSource.asset.videoUri, 3600)
          : undefined,
      };
    }),
  revisionSubmit: protectedProcedure
    .input(codeMotionRevisionInputSchema)
    .mutation(({ ctx, input }) =>
      submitCodeMotionRevision(String(ctx.user.id), input)
    ),
  grant: protectedProcedure
    .input(project)
    .query(({ ctx, input }) =>
      getCodeMotionProductionGrant(String(ctx.user.id), input.projectId)
    ),
  start: protectedProcedure.input(version).mutation(({ ctx, input }) =>
    ensureCodeMotionProductionGrant(String(ctx.user.id), {
      ...input,
      source: inkSource(ctx.req),
    })
  ),
  prepare: protectedProcedure
    .input(version)
    .query(({ ctx, input }) =>
      prepareCodeMotionProductionVideo(String(ctx.user.id), input)
    ),
  submit: protectedProcedure
    .input(
      version.extend({
        confirmedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      })
    )
    .mutation(({ ctx, input }) =>
      submitCodeMotionProductionVideo(String(ctx.user.id), input, ctx.req)
    ),
  list: protectedProcedure
    .input(project)
    .query(({ ctx, input }) =>
      listCodeMotionProductionVideo(String(ctx.user.id), input.projectId)
    ),
  adopt: protectedProcedure
    .input(project.extend({ sceneIndex: z.number().int().min(0).max(5) }))
    .mutation(({ ctx, input }) =>
      adoptCodeMotionProductionVideo(
        String(ctx.user.id),
        input.projectId,
        input.sceneIndex
      )
    ),
});
