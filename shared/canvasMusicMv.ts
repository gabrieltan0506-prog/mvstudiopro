import { z } from "zod";

const text = z.string().trim().min(1);
export const canvasMusicCandidateSchema = z
  .object({
    id: text.max(200),
    url: z
      .string()
      .url()
      .refine(value => value.startsWith("https://"), "音乐地址须为 HTTPS"),
    durationSec: z.number().finite().positive().max(3600),
    title: z.string().max(200).optional(),
    gcsUri: z
      .string()
      .regex(/^gs:\/\/[^/]+\/.+/)
      .optional(),
  })
  .strict();
export type CanvasMusicCandidate = z.infer<typeof canvasMusicCandidateSchema>;

export const canvasMusicMvShotSchema = z
  .object({
    id: text.max(100),
    startSec: z.number().finite().min(0),
    endSec: z.number().finite().positive(),
    visualPrompt: text.max(4000),
    cameraPrompt: text.max(1000),
    lyricQuote: z.string().max(2000),
    referenceIndices: z.array(z.number().int().min(0)),
  })
  .strict();
export const canvasMusicMvPlanSchema = z
  .object({
    version: z.literal(1),
    audioId: text.max(200),
    audioDurationSec: z.number().finite().positive().max(3600),
    // 分镜以歌词与创意说明为依据，不伪装已听取音乐或已测定节拍。
    analysisBasis: z.literal("lyrics_and_user_description"),
    shots: z.array(canvasMusicMvShotSchema).min(1),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const ids = new Set<string>();
    let cursor = 0;
    plan.shots.forEach((shot, index) => {
      if (ids.has(shot.id))
        ctx.addIssue({
          code: "custom",
          message: "镜头编号重复",
          path: ["shots", index, "id"],
        });
      ids.add(shot.id);
      if (Math.abs(shot.startSec - cursor) > 0.000001)
        ctx.addIssue({
          code: "custom",
          message: "镜头时间必须无缝连续",
          path: ["shots", index, "startSec"],
        });
      const duration = shot.endSec - shot.startSec;
      if (duration + 1e-9 < 0.5 || duration > 15 + 1e-9)
        ctx.addIssue({
          code: "custom",
          message: "每镜时长必须为 0.5 至 15 秒",
          path: ["shots", index, "endSec"],
        });
      cursor = shot.endSec;
    });
    if (Math.abs(cursor - plan.audioDurationSec) > 0.000001)
      ctx.addIssue({
        code: "custom",
        message: "分镜必须覆盖完整音乐时长",
        path: ["shots"],
      });
  });
export type CanvasMusicMvPlan = z.infer<typeof canvasMusicMvPlanSchema>;

export const canvasMusicMvDraftInputSchema = z
  .object({
    requestId: z.string().uuid(),
    audio: canvasMusicCandidateSchema,
    lyrics: z.string().max(30000).default(""),
    creativePrompt: text.max(10000),
    referenceSummaries: z.array(text.max(2000)).max(100).default([]),
  })
  .strict();
export type CanvasMusicMvDraftInput = z.infer<
  typeof canvasMusicMvDraftInputSchema
>;

export function validateCanvasMusicMvPlan(
  raw: unknown,
  input: CanvasMusicMvDraftInput
): CanvasMusicMvPlan {
  const plan = canvasMusicMvPlanSchema.parse(raw);
  if (
    plan.audioId !== input.audio.id ||
    plan.audioDurationSec !== input.audio.durationSec
  )
    throw new Error("分镜音乐身份或时长不一致");
  for (const shot of plan.shots) {
    if (shot.lyricQuote && !input.lyrics.includes(shot.lyricQuote))
      throw new Error("分镜引用了输入中不存在的歌词");
    if (
      shot.referenceIndices.some(
        index => index >= input.referenceSummaries.length
      )
    )
      throw new Error("分镜引用了不存在的参考素材");
  }
  if (input.lyrics.trim() && !plan.shots.some(shot => shot.lyricQuote.trim()))
    throw new Error("有歌词的音乐须在分镜中引用原文");
  return plan;
}

export const canvasMusicMvAssembleSnapshotSchema = z
  .object({
    requestId: z.string().uuid(),
    planRequestId: z.string().uuid(),
    audio: canvasMusicCandidateSchema,
    plan: canvasMusicMvPlanSchema,
    clips: z
      .array(
        z
          .object({
            shotId: text,
            url: z.string().url(),
            taskId: text.optional(),
          })
          .strict()
      )
      .min(1),
    resolution: z.enum(["16:9", "9:16"]),
  })
  .strict();

export const canvasMusicMvShotBindingSchema = z
  .object({
    planRequestId: z.string().uuid(),
    audioId: text.max(200),
    shotId: text.max(100),
    startSec: z.number().finite().min(0),
    endSec: z.number().finite().positive(),
    referenceImages: z.array(
      z
        .object({
          id: text,
          url: z.string().url(),
          gcsUri: z.string().startsWith("gs://").optional(),
          fileName: z.string(),
        })
        .strict()
    ),
    activeTask: z
      .object({ taskId: text, inputFingerprint: text })
      .strict()
      .optional(),
    outputs: z
      .array(z.object({ taskId: text, url: z.string().url() }).strict())
      .optional(),
  })
  .strict();
export type CanvasMusicMvShotBinding = z.infer<
  typeof canvasMusicMvShotBindingSchema
>;

export const canvasMusicMvStateSchema = z
  .object({
    status: z.enum([
      "idle",
      "music_running",
      "music_ready",
      "planning",
      "planned",
      "rendering",
      "assembling",
      "done",
      "error",
    ]),
    // 所有返回变体保留，不设置固定数量截断。
    candidates: z.array(canvasMusicCandidateSchema),
    selectedCandidateId: text.max(200).optional(),
    plan: canvasMusicMvPlanSchema.optional(),
    lyrics: z.string().max(30000).optional(),
    creativePrompt: z.string().max(10000).optional(),
    requestedDurationSec: z.number().finite().positive().max(3600).optional(),
    instrumental: z.boolean().optional(),
    musicRequestId: z.string().uuid().optional(),
    musicJobId: text.max(200).optional(),
    musicJobStatus: text.max(100).optional(),
    missingVariants: z.number().int().min(0).optional(),
    planRequestId: z.string().uuid().optional(),
    planInput: canvasMusicMvDraftInputSchema.optional(),
    referenceImages: z
      .array(
        z
          .object({
            id: text.max(200),
            url: z
              .string()
              .url()
              .refine(
                value => value.startsWith("https://"),
                "参考图地址须为 HTTPS"
              ),
            gcsUri: z.string().startsWith("gs://").optional(),
            fileName: z.string().max(1000),
          })
          .strict()
      )
      .optional(),
    shotBlockIds: z.array(text.max(200)).optional(),
    assembleRequestId: z.string().uuid().optional(),
    assembleJobId: text.max(200).optional(),
    assembleInput: canvasMusicMvAssembleSnapshotSchema.optional(),
    finalBlockId: text.max(200).optional(),
    error: z.string().max(2000).optional(),
  })
  .strict()
  .superRefine((state, ctx) => {
    const ids = state.candidates.map(item => item.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        message: "音乐变体编号重复",
        path: ["candidates"],
      });
    const selected = state.candidates.find(
      item => item.id === state.selectedCandidateId
    );
    if (state.selectedCandidateId && !selected)
      ctx.addIssue({
        code: "custom",
        message: "所选音乐变体不存在",
        path: ["selectedCandidateId"],
      });
    if (
      state.plan &&
      (!selected ||
        state.plan.audioId !== selected.id ||
        state.plan.audioDurationSec !== selected.durationSec)
    )
      ctx.addIssue({
        code: "custom",
        message: "分镜与所选音乐不一致",
        path: ["plan"],
      });
    if (
      state.planInput &&
      (state.planRequestId !== state.planInput.requestId ||
        state.selectedCandidateId !== state.planInput.audio.id)
    )
      ctx.addIssue({
        code: "custom",
        message: "原分镜请求与当前音乐身份不一致",
        path: ["planInput"],
      });
    if (state.status === "planned" && !state.plan)
      ctx.addIssue({
        code: "custom",
        message: "已规划状态缺少分镜",
        path: ["plan"],
      });
  });
export type CanvasMusicMvState = z.infer<typeof canvasMusicMvStateSchema>;
export function normalizeCanvasMusicMvState(raw: unknown): CanvasMusicMvState {
  return canvasMusicMvStateSchema.parse(raw);
}

/** 累计绝对秒位先对齐30fps，再相减，避免逐镜取整让整首音乐逐渐错位。 */
export function musicMvRenderDurationSec(shot: {
  startSec: number;
  endSec: number;
}): number {
  const start = Math.round(shot.startSec * 30);
  const end = Math.round(shot.endSec * 30);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    end - start < 15
  ) {
    throw new Error("镜头不足半秒，无法按完整MV时间轴裁切");
  }
  return (end - start) / 30;
}
