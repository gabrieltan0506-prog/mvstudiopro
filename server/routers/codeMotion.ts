import { analyzeCodeMotionTiming } from "../services/codeMotionTiming";
import { prepareCodeMotionImages, submitCodeMotionImages, listCodeMotionImages, adoptCodeMotionImage } from "../services/codeMotionImages";
import { ensureCodeMotionProductionGrant, prepareCodeMotionProductionGrant, getCodeMotionProductionGrant } from "../services/codeMotionProductionGrant";
import {
  CODE_MOTION_AUDIO_SOURCE_LIMIT,
  codeMotionSoundRequestSchema,
} from "../../shared/codeMotionMedia";
import {
  submitCodeMotionSound,
  listCodeMotionSounds,
  adoptCodeMotionSound,
} from "../services/codeMotionSound";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  codeMotionProjectSchema,
  codeMotionImageSchema,
  codeMotionSceneDescription,
  CODE_MOTION_COST_NOTE,
} from "../../shared/codeMotion";
import { assertCodeMotionImageSource } from "../services/codeMotionImport";
import { codeMotionAudioSourceSchema } from "../../shared/codeMotionAudio";
import {
  importCodeMotionAudio,
  assertCodeMotionAudioOwnership,
} from "../services/codeMotionAudio";
import {
  loadCodeMotion,
  saveCodeMotion,
  listCodeMotion,
} from "../services/codeMotionStore";
import {
  codeMotionRenderIdentity,
  findCodeMotionTask,
  submitCodeMotion,
} from "../services/codeMotionTask";
import { resolveRegisteredPostProdMediaSource } from "../services/postProdMediaSource";
import { signGsUriV4ReadUrl } from "../services/gcs";
import { inkSource, quoteInkFree } from "../services/inkFreeQuota";
import { assertCodeMotionProductionVideos } from "../services/codeMotionProductionVideo";
const id = z.object({ projectId: z.string().uuid() });
async function owned(userId: string, projectId: string) {
  const saved = await loadCodeMotion(userId, projectId);
  if (!saved)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "没有找到这份作品，请先保存",
    });
  return saved;
}
export const codeMotionRouter = router({
  analyzeTiming: protectedProcedure
    .input(id.extend({generation:z.string().regex(/^\d+$/),sourceId:z.string().uuid()}))
    .mutation(async ({ctx,input})=>{
      const userId=String(ctx.user.id),saved=await owned(userId,input.projectId);
      if(saved.generation!==input.generation)throw new TRPCError({code:"CONFLICT",message:"请先保存当前作品后分析词拍"});
      const source=saved.project.brief.audios?.find(s=>s.id===input.sourceId);
      if(!source || !saved.project.plan?.audioTimeline?.some(c=>c.sourceId===source.id && c.volume>0))throw new TRPCError({code:"BAD_REQUEST",message:"请先在本作品选用这份原音"});
      const clips=saved.project.plan!.audioTimeline!.filter(c=>c.sourceId===source.id && c.volume>0);
      const windowStart=Math.min(...clips.map(c=>c.trimStart)),windowEnd=Math.max(...clips.map(c=>c.trimStart+c.duration));
      if(windowEnd-windowStart>30+1e-6)throw new TRPCError({code:"BAD_REQUEST",message:"一次词拍分析只处理已采用的30秒原音窗，请缩短所选音轨"});
      const grant=await ensureCodeMotionProductionGrant(userId,{projectId:input.projectId,expectedGeneration:input.generation,source:inkSource(ctx.req)});
      return analyzeCodeMotionTiming(userId,{projectId:input.projectId,grantId:grant.id,source,windowStart,windowDuration:Math.min(30,windowEnd-windowStart)});
    }),
  imagePrepare: protectedProcedure
    .input(id.extend({ expectedGeneration: z.string().regex(/^\d+$/) }))
    .mutation(async ({ ctx, input }) => {
      const userId = String(ctx.user.id);
      const grant = await prepareCodeMotionProductionGrant(userId, input);
      return prepareCodeMotionImages(userId, { ...input, grantId: grant.id });
    }),
  imageSubmit: protectedProcedure
    .input(id.extend({ expectedGeneration: z.string().regex(/^\d+$/), grantId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }))
    .mutation(async ({ ctx, input }) => {
      const userId = String(ctx.user.id);
      const grant = (await getCodeMotionProductionGrant(userId, input.projectId, input.grantId)) ?? await ensureCodeMotionProductionGrant(userId, { ...input, source: inkSource(ctx.req) });
      if (grant.id !== input.grantId) throw new TRPCError({ code: "CONFLICT", message: "制作内容已变化，请恢复原批次" });
      return submitCodeMotionImages(userId, input);
    }),
  imageList: protectedProcedure.input(id).query(({ ctx, input }) => listCodeMotionImages(String(ctx.user.id), input.projectId)),
  imageAdopt: protectedProcedure
    .input(id.extend({ grantId: z.string().uuid(), index: z.number().int().min(0).max(5) }))
    .mutation(({ ctx, input }) => adoptCodeMotionImage(String(ctx.user.id), input)),

  sounds: protectedProcedure
    .input(id)
    .query(({ ctx, input }) =>
      listCodeMotionSounds(String(ctx.user.id), input.projectId)
    ),
  generateSound: protectedProcedure
    .input(
      id.extend({
        generation: z.string().regex(/^\d+$/),
        request: codeMotionSoundRequestSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const grant = await ensureCodeMotionProductionGrant(String(ctx.user.id), { projectId: input.projectId, expectedGeneration: input.generation, source: inkSource(ctx.req) });
      return submitCodeMotionSound(
        String(ctx.user.id),
        input.projectId,
        input.generation,
        input.request,
        undefined,
        { grantId: grant.id }
      );
    }),
  adoptSound: protectedProcedure
    .input(
      id.extend({
        requestId: z.string().uuid(),
        variantIndex: z.number().int().min(0).max(10),
      })
    )
    .mutation(({ ctx, input }) =>
      adoptCodeMotionSound(
        String(ctx.user.id),
        input.projectId,
        input.requestId,
        input.variantIndex
      )
    ),
  freeQuote: protectedProcedure.query(({ ctx }) =>
    quoteInkFree(String(ctx.user.id), inkSource(ctx.req))
  ),
  quote: protectedProcedure.query(async ({ ctx }) => {
    const { countPlatformSkillQaToday } = await import(
      "../services/platformSkillQa"
    );
    const { platformSkillQaDailyFreeLimit } = await import(
      "../../shared/plans"
    );
    const { resolvePlatformSkillQaPaidCredits } = await import(
      "../config/platformSwitches"
    );
    const privileged =
      ctx.user.role === "admin" || ctx.user.role === "supervisor";
    const used = privileged
      ? 0
      : await countPlatformSkillQaToday(ctx.user.id, "terra", false);
    const limit = platformSkillQaDailyFreeLimit("terra");
    return {
      speechEnabled: true,
      remainingFreeToday: Math.max(0, limit - used),
      credits:
        privileged || used < limit
          ? 0
          : resolvePlatformSkillQaPaidCredits("terra"),
    };
  }),
  resolveImages: protectedProcedure
    .input(z.object({ images: z.array(codeMotionImageSchema).max(8) }))
    .query(async ({ ctx, input }) => {
      const userId = String(ctx.user.id);
      return Promise.all(
        input.images.map(async image => {
          assertCodeMotionImageSource(userId, image.gcsUri);
          const uri = await resolveRegisteredPostProdMediaSource({
            userId,
            source: image.gcsUri,
          });
          return {
            id: image.id,
            name: image.name,
            url: signGsUriV4ReadUrl(uri, 3600),
          };
        })
      );
    }),
  importAudio: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1).max(160),
        gcsUri: z
          .string()
          .regex(/^gs:\/\//)
          .max(2048),
      })
    )
    .mutation(({ ctx, input }) =>
      importCodeMotionAudio({ ...input, userId: String(ctx.user.id) })
    ),
  resolveAudios: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        audios: z
          .array(codeMotionAudioSourceSchema)
          .max(CODE_MOTION_AUDIO_SOURCE_LIMIT),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = String(ctx.user.id);
      return Promise.all(
        input.audios.map(async audio => {
          await assertCodeMotionAudioOwnership({
            userId,
            projectId: input.projectId,
            audio: {
              sources: [audio],
              audioTimeline: [
                {
                  sourceId: audio.id,
                  role: "narration",
                  at: 0,
                  trimStart: 0,
                  duration: Math.min(audio.duration, 180),
                  volume: 1,
                  fadeIn: 0,
                  fadeOut: 0,
                },
              ],
            },
          });
          return {
            id: audio.id,
            name: audio.name,
            url: signGsUriV4ReadUrl(audio.gcsUri, 3600),
          };
        })
      );
    }),
  importFile: protectedProcedure
    .input(
      z.object({
        gcsUri: z
          .string()
          .regex(/^gs:\/\//)
          .max(2048),
        name: z.string().min(1).max(160),
        bytes: z
          .number()
          .int()
          .positive()
          .max(8 * 1024 * 1024),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { importCodeMotionFile } = await import(
        "../services/codeMotionImport"
      );
      return importCodeMotionFile(String(ctx.user.id), input);
    }),
  list: protectedProcedure.query(({ ctx }) =>
    listCodeMotion(String(ctx.user.id))
  ),
  get: protectedProcedure
    .input(id)
    .query(({ ctx, input }) =>
      loadCodeMotion(String(ctx.user.id), input.projectId)
    ),
  save: protectedProcedure
    .input(
      z.object({
        project: codeMotionProjectSchema,
        expectedGeneration: z.string().regex(/^\d+$/),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.project.plan?.codeVideo) await assertCodeMotionProductionVideos(String(ctx.user.id), input.project.id, input.project.plan.codeVideo);
      for (const image of input.project.brief.images) {
        assertCodeMotionImageSource(String(ctx.user.id), image.gcsUri);
        await resolveRegisteredPostProdMediaSource({
          userId: String(ctx.user.id),
          source: image.gcsUri,
        });
      }
      for (const audio of input.project.brief.audios || [])
        await assertCodeMotionAudioOwnership({
          userId: String(ctx.user.id),
          projectId: input.project.id,
          audio: {
            sources: [audio],
            audioTimeline: [
              {
                sourceId: audio.id,
                role: "narration",
                at: 0,
                trimStart: 0,
                duration: Math.min(audio.duration, 180),
                volume: 1,
                fadeIn: 0,
                fadeOut: 0,
              },
            ],
          },
        });
      return saveCodeMotion(
        String(ctx.user.id),
        input.project,
        input.expectedGeneration
      );
    }),
  prepare: protectedProcedure.input(id).query(async ({ ctx, input }) => {
    const userId = String(ctx.user.id),
      saved = await owned(userId, input.projectId);
    let pendingProduction: string | null = null;
    let identity;
    try { identity = codeMotionRenderIdentity(userId, saved.project); }
    catch (error) {
      if (!(error instanceof Error) || !/尚未|请先试听|请先核对词拍|配音/.test(error.message)) throw error;
      pendingProduction = error.message;
      identity = codeMotionRenderIdentity(userId, saved.project, {allowPendingSpeech:true,allowPendingProduction:true});
    }
    if (identity.spec.codeVideo) await assertCodeMotionProductionVideos(userId, input.projectId, identity.spec.codeVideo);
    const videos = (identity.spec.codeVideo?.assets || []).map(asset => ({ id: asset.id, url: signGsUriV4ReadUrl(asset.videoUri, 3600) }));
    const productionGrant = await getCodeMotionProductionGrant(userId, input.projectId);
    const sceneCount = saved.project.plan!.scenes.length;
    const productionQuote = productionGrant || (sceneCount >= 4 && sceneCount <= 6 && saved.project.brief.duration <= 30
      ? await prepareCodeMotionProductionGrant(userId, { projectId: input.projectId, expectedGeneration: saved.generation }) : null);
    const freeEligibility = await quoteInkFree(userId, inkSource(ctx.req));
    if (identity.spec.codeAudio)
      await assertCodeMotionAudioOwnership({
        userId,
        projectId: input.projectId,
        audio: identity.spec.codeAudio,
      });
    const audios = (saved.project.brief.audios || []).map(audio => ({
      ...audio,
      url: signGsUriV4ReadUrl(audio.gcsUri, 3600),
    }));
    const images = await Promise.all(
      saved.project.brief.images.map(async image => {
        assertCodeMotionImageSource(userId, image.gcsUri);
        const uri = await resolveRegisteredPostProdMediaSource({
          userId,
          source: image.gcsUri,
        });
        return {
          id: image.id,
          name: image.name,
          url: signGsUriV4ReadUrl(uri, 3600),
        };
      })
    );
    const cues = identity.spec.cues.map(cue => ({
      ...cue,
      ...(cue.imageUri
        ? {
            image: images.find(
              i =>
                saved.project.brief.images.find(x => x.id === i.id)?.gcsUri ===
                cue.imageUri
            )?.url,
          }
        : {}),
    }));
    return {
      generation: saved.generation,
      fingerprint: identity.fingerprint,
      spec: { ...identity.spec, cues },
      images,
      audios,
      videos,
      productionTier: productionQuote?.tier,
      pendingProduction,
      scenes: saved.project.plan!.scenes.map(scene => ({
        ...scene,
        movement:
          scene.direction ||
          codeMotionSceneDescription(
            saved.project.brief.style,
            !!scene.imageId
          ),
      })),
      costNote: CODE_MOTION_COST_NOTE,
      credits: 0,
      freeEligibility: productionGrant || productionQuote?.tier === "paid" ? { ...freeEligibility, eligible: true } : freeEligibility,
      requestId: identity.requestId,
      job: pendingProduction ? null : await findCodeMotionTask(userId, saved.project),
    };
  }),
  history: protectedProcedure.input(id).query(async ({ ctx, input }) => {
    const { listCodeMotionVideos } = await import("../services/codeMotionTask");
    return listCodeMotionVideos(String(ctx.user.id), input.projectId);
  }),
  status: protectedProcedure.input(id).query(async ({ ctx, input }) => {
    const saved = await owned(String(ctx.user.id), input.projectId);
    if (!saved.project.plan) return null;
    try { codeMotionRenderIdentity(String(ctx.user.id), saved.project); }
    catch (error) { if (error instanceof Error && /先生成|尚未|旁白|视频片段|请先核对词拍/.test(error.message)) return null; throw error; }
    return findCodeMotionTask(String(ctx.user.id), saved.project);
  }),
  submit: protectedProcedure
    .input(
      id.extend({
        expectedGeneration: z.string().regex(/^\d+$/),
        confirmedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        confirmedCredits: z.literal(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const saved = await owned(String(ctx.user.id), input.projectId);
      if (saved.generation !== input.expectedGeneration)
        throw new TRPCError({
          code: "CONFLICT",
          message: "作品已变化，请重新查看本次内容",
        });
      return submitCodeMotion(
        String(ctx.user.id),
        saved.project,
        input.confirmedFingerprint,
        undefined,
        inkSource(ctx.req)
      );
    }),
});
