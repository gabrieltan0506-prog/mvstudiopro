import { inkFreeSpeechEnabled } from "../services/inkFreeSpeechConfig";
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
      speechEnabled: inkFreeSpeechEnabled(),
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
        audios: z.array(codeMotionAudioSourceSchema).max(3),
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
                  duration: audio.duration,
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
                duration: audio.duration,
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
    const identity = codeMotionRenderIdentity(userId, saved.project);
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
      freeEligibility: await quoteInkFree(userId, inkSource(ctx.req)),
      requestId: identity.requestId,
      job: await findCodeMotionTask(userId, saved.project),
    };
  }),
  history: protectedProcedure.input(id).query(async ({ ctx, input }) => {
    const { listCodeMotionVideos } = await import("../services/codeMotionTask");
    return listCodeMotionVideos(String(ctx.user.id), input.projectId);
  }),
  status: protectedProcedure.input(id).query(async ({ ctx, input }) => {
    const saved = await owned(String(ctx.user.id), input.projectId);
    return saved.project.plan
      ? findCodeMotionTask(String(ctx.user.id), saved.project)
      : null;
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
