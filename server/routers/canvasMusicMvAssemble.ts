import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { createJob, getJobByIdStrict } from "../jobs/repository";
import {
  musicMvRenderDurationSec,
  canvasMusicCandidateSchema,
  canvasMusicMvPlanSchema,
  canvasMusicMvDraftInputSchema,
} from "../../shared/canvasMusicMv";
import { buildManhuaAssembleJobInput } from "../../shared/manhuaAssembleJobInput";
import { stableManhuaBgmJson } from "../jobs/manhuaBgmJobInput";
import {
  resolveCanvasMusicMvAudio,
  resolveCanvasMusicMvVideo,
} from "../services/canvasMusicMvMedia";
import { downloadGcsObjectVersioned, getGcsBucketName } from "../services/gcs";

export const canvasMusicMvAssembleRouter = router({
  queue: protectedProcedure
    .input(
      z
        .object({
          requestId: z.string().uuid(),
          planRequestId: z.string().uuid(),
          musicJobId: z.string().trim().min(1).max(200).optional(),
          audio: canvasMusicCandidateSchema,
          plan: canvasMusicMvPlanSchema,
          clips: z
            .array(
              z
                .object({
                  shotId: z.string().trim().min(1),
                  url: z.string().url(),
                  taskId: z.string().trim().min(1).max(200).optional(),
                })
                .strict()
            )
            .min(1),
          resolution: z.enum(["16:9", "9:16"]).default("16:9"),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      if (
        input.plan.audioId !== input.audio.id ||
        input.plan.audioDurationSec !== input.audio.durationSec ||
        input.clips.length !== input.plan.shots.length ||
        new Set(input.clips.map(c => c.shotId)).size !== input.clips.length
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "歌曲与镜头不匹配，请重新确认分镜",
        });
      }
      const userId = String(ctx.user.id);
      // 原始分镜来自本人永久证据，客户端同编号换歌或改写计划不能绕过接受记录。
      let saved;
      try {
        const receipt = await downloadGcsObjectVersioned({
          gcsUri: `gs://${getGcsBucketName()}/canvas-music-mv/evidence/${userId}/${input.planRequestId}/result.json`,
        });
        const settled = await downloadGcsObjectVersioned({
          gcsUri: `gs://${getGcsBucketName()}/canvas-music-mv/evidence/${userId}/${input.planRequestId}/settled.json`,
        });
        if (JSON.parse(settled.buffer.toString("utf8")).settled !== true)
          throw new Error("分镜结算尚未确认");
        const raw = JSON.parse(receipt.buffer.toString("utf8"));
        saved = {
          input: canvasMusicMvDraftInputSchema.parse(raw.input),
          plan: canvasMusicMvPlanSchema.parse(raw.plan),
        };
      } catch {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "原分镜记录暂不可核对，请查询原分镜任务",
        });
      }
      if (
        saved.input.requestId !== input.planRequestId ||
        stableManhuaBgmJson(saved.plan) !== stableManhuaBgmJson(input.plan) ||
        saved.input.audio.id !== input.audio.id ||
        saved.input.audio.durationSec !== input.audio.durationSec
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "分镜版本或所选歌曲已经变化，请重新确认分镜",
        });
      }
      // 入队只保存稳定来源。所有权在服务端登记簿核对，拒绝任意外部网址、跨用户及跨桶素材。
      let musicUrl: string;
      let clipSources: string[];
      try {
        musicUrl = await resolveCanvasMusicMvAudio(
          ctx.user.id,
          input.audio,
          input.musicJobId
        );
        const originalMusic = await resolveCanvasMusicMvAudio(
          ctx.user.id,
          saved.input.audio,
          input.musicJobId
        );
        if (musicUrl !== originalMusic) throw new Error("歌曲来源改变");
        clipSources = await Promise.all(
          input.clips.map(clip => resolveCanvasMusicMvVideo(ctx.user.id, clip))
        );
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "素材来源不匹配或尚未登记，请从本人系统素材重新选择",
        });
      }
      const clips = input.plan.shots.map((shot, index) => {
        const sourceIndex = input.clips.findIndex(
          row => row.shotId === shot.id
        );
        if (sourceIndex < 0)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "缺少镜头，不能合成完整 MV",
          });
        const durationSec = musicMvRenderDurationSec(shot);
        if (durationSec < 0.5)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "镜头短于可合成范围，请重新确认分镜",
          });
        return {
          episodeIndex: 1,
          segmentIndex: index + 1,
          clipUrl: clipSources[sourceIndex],
          durationSec,
          trimInSec: 0,
          trimOutSec: durationSec,
        };
      });
      const payload = buildManhuaAssembleJobInput({
        clips,
        expectedSegments: clips.map(({ episodeIndex, segmentIndex }) => ({
          episodeIndex,
          segmentIndex,
        })),
        musicUrl,
        musicOnly: true,
        musicVolume: 1,
        musicFadeInSec: 0,
        musicFadeOutSec: 0,
        transition: "cut",
        resolution: input.resolution,
      });
      const jobId = `music_mv_${ctx.user.id}_${input.requestId.replace(/-/g, "")}`;
      // 相同编号先读已存在任务，不再次创建；原子唯一键兜住并发首次请求。
      const assertExisting = (
        existing: Awaited<ReturnType<typeof getJobByIdStrict>>
      ) => {
        if (
          !existing ||
          String(existing.userId) !== userId ||
          existing.type !== "video" ||
          existing.provider !== "manhua-assemble" ||
          stableManhuaBgmJson(existing.input) !== stableManhuaBgmJson(payload)
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "合成编号对应的内容不同，请查询原任务",
          });
        }
      };
      try {
        const existing = await getJobByIdStrict(jobId);
        if (existing) {
          assertExisting(existing);
          return { jobId };
        }
        try {
          await createJob({
            id: jobId,
            userId,
            type: "video",
            provider: "manhua-assemble",
            input: payload,
          });
        } catch {
          assertExisting(await getJobByIdStrict(jobId));
        }
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "合成任务暂不可核对，请查询原编号，勿重复提交",
        });
      }
      return { jobId };
    }),
});
