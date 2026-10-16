import {songCoverReceiptSchema} from "./songCover";
import { canvasMusicCandidateSchema } from "./canvasMusicMedia";
import { creativeLearningSessionSchema } from "./creativeGenerationLibrary";
import { musicEmotionTurnSchema, musicEmotionArcSchema } from "./musicEmotion";
import { z } from "zod";
import { creativeEvidenceReviewSchema } from "./creativeEvidenceReview";
import { musicMvEditSessionSchema } from "./canvasMusicMvEdit";
import { songOperationSessionSchema, songAlignedWordSchema } from "./songOperations";

const text = z.string().trim().min(1);
export { canvasMusicCandidateSchema, type CanvasMusicCandidate } from "./canvasMusicMedia";

export const sunoSongBriefSchema = z
  .object({
    model: z.literal("suno-v6"),
    custom_mode: z.literal(true),
    instrumental: z.boolean(),
    title: text.max(80),
    style: text,
    prompt: text.max(5000),
    negative_tags: z.string().max(200),
    duration: z.number().int().min(10).max(360),
    style_weight: z.number().min(0).max(1).multipleOf(0.01),
    weirdness_constraint: z.number().min(0).max(1).multipleOf(0.01),
  })
  .strict();
export type SunoSongBrief = z.infer<typeof sunoSongBriefSchema>;
export const sunoSongTargetSchema = z
  .object({
    sourceKey: text.max(200),
    audio: canvasMusicCandidateSchema.optional(),
    referenceMediaKind: z.enum(["audio", "video"]).optional(),
    requirements: text.max(6000),
    craftIds: z.array(text.max(200)).max(3).optional(),
    originalBrief: sunoSongBriefSchema.optional(),
  })
  .strict();
export type SunoSongTarget = z.infer<typeof sunoSongTargetSchema>;
export const sunoSongProposalSchema = z
  .object({
    kind: z.literal("suno_song_v1"),
    sourceKey: text.max(200),
    evidenceId: z.string().uuid().optional(),
    review: creativeEvidenceReviewSchema.optional(),
    craftSelections: z.array(z.object({id:text.max(200),reasonZh:text.max(2000),applicationZh:text.max(3000)}).strict()).min(2).max(3).optional(),
    summaryZh: text.max(4000),
    uncertaintiesZh: z.array(text.max(1000)),
    sections: z.array(
      z
        .object({
          startSec: z.number().finite().min(0),
          endSec: z.number().finite().positive(),
          labelZh: text.max(100),
          heardZh: text.max(2000),
            emotion: musicEmotionTurnSchema.optional(),
        })
        .strict()
    ),
    transferableCraft: z.array(text.max(1500)).min(1),
    concepts: z
      .array(
        z
          .object({
            id: text.max(100),
            rationaleZh: text.max(3000),
            emotionalArc: musicEmotionArcSchema.optional(),
            differenceZh: text.max(3000),
            hookZh: text.max(1000),
            lyricMethodZh: text.max(3000).optional(),
            mvDirectionZh: text.max(5000).optional(),
            brief: sunoSongBriefSchema,
          })
          .strict()
      )
      .min(3).max(4),
  })
  .strict();
export function parseSunoSongProposal(raw: unknown, target: SunoSongTarget) {
  const p = sunoSongProposalSchema.parse(
    typeof raw === "string" ? JSON.parse(raw) : raw
  );
  if (
    p.sourceKey !== target.sourceKey ||
    new Set(p.concepts.map(c => c.id)).size !== p.concepts.length
  )
    throw new Error("新歌方案来源或编号不一致");
  if (target.originalBrief) {
    const original=target.originalBrief;
    for (const concept of p.concepts) {
      if (concept.brief.prompt!==original.prompt || concept.brief.title!==original.title || concept.brief.instrumental!==original.instrumental || concept.brief.duration!==original.duration)
        throw new Error("提示词优化不得改写原歌词、标题、演唱类型或完整版目标时长");
    }
  }
  if (!target.audio) {
    if (p.sections.length) throw new Error("未提供音频，不能生成听音时间线");
    return p;
  }
  let end = 0;
  for (const section of p.sections) {
    if (
      Math.abs(section.startSec - end) > 0.1 ||
      section.endSec <= section.startSec ||
      section.endSec > target.audio.durationSec + 0.1
    )
      throw new Error("听音段落时间不连续或越界");
    end = section.endSec;
  }
  if (Math.abs(end - target.audio.durationSec) > 0.1)
    throw new Error("听音未覆盖完整参考歌曲");
  return p;
}
export const sunoSongSessionSchema = z
  .object({
    requestId: z.string().uuid(),
    projectId: z.string().optional(),
    videoModel: z.string(),
    target: sunoSongTargetSchema,
    status: z.enum(["pending", "succeeded", "failed"]),
    proposal: sunoSongProposalSchema.optional(),
  })
  .strict();
export type SunoSongSession = z.infer<typeof sunoSongSessionSchema>;

export const songDemoVariantSchema=z.object({musicId:text.max(200).optional(),providerTaskId:text.max(200).optional(),index:z.number().int().nonnegative(),sourceGcsUri:text,durationSec:z.number().positive(),gcsUri:text.optional(),url:z.string().url().optional(),status:z.enum(["pending","ready","failed"]),error:z.string().optional()}).strict();
export const songDemoRunSchema=z.object({requestId:z.string().uuid(),advisorRequestId:z.string().uuid(),conceptId:text,fullBrief:sunoSongBriefSchema,demoBrief:sunoSongBriefSchema,musicJobId:text,status:z.enum(["submitting","queued","running","processing","ready","failed"]),variants:z.array(songDemoVariantSchema),error:z.string().optional()}).strict();
export type SongDemoRun=z.infer<typeof songDemoRunSchema>;
export type SongDemoVariant=z.infer<typeof songDemoVariantSchema>;

export const musicMvSourceClipSchema = z
  .object({
    assetId: text.max(200),
    url: z.string().url(),
    taskId: text.max(200).optional(),
    durationSec: z.number().finite().positive().max(3600),
    sourceStartSec: z.number().finite().min(0),
  })
  .strict();
export const MUSIC_MV_SHOT_LABELS = {
  generated: "生成画面",
  singing: "对口型表演",
  footage: "已有素材切片",
} as const;

export const canvasMusicMvShotSchema = z
  .object({
    id: text.max(100),
    startSec: z.number().finite().min(0),
    endSec: z.number().finite().positive(),
    visualPrompt: text.max(4000),
    cameraPrompt: text.max(1000),
    lyricQuote: z.string().max(2000),
    referenceIndices: z.array(z.number().int().min(0)),
    // 缺省保持历史分镜的普通生成行为。
    kind: z.enum(["generated", "singing", "footage"]).optional(),
    sourceClip: musicMvSourceClipSchema.optional(),
  })
  .strict();
export const canvasMusicMvPlanSchema = z
  .object({
    version: z.literal(1),
    audioId: text.max(200),
    audioDurationSec: z.number().finite().positive().max(3600),
    // 分镜以歌词与创意说明为依据，不伪装已听取音乐或已测定节拍。
    analysisBasis: z.enum(["lyrics_and_user_description", "native_audio"]),
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
      if (shot.kind === "footage") {
        if (
          !shot.sourceClip ||
          shot.sourceClip.sourceStartSec + duration >
            shot.sourceClip.durationSec + 1e-6
        )
          ctx.addIssue({
            code: "custom",
            path: ["shots", index, "sourceClip"],
            message: "素材切片缺少真实来源或选段越界",
          });
      } else if (shot.sourceClip) {
        ctx.addIssue({
          code: "custom",
          path: ["shots", index, "sourceClip"],
          message: "只有素材切片可以绑定源视频",
        });
      }
      if (
        shot.kind === "singing" &&
        (duration < 4 || !shot.referenceIndices.length)
      )
        ctx.addIssue({
          code: "custom",
          path: ["shots", index],
          message: "对口型镜头至少4秒且须绑定人物参考图",
        });
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

export const musicMvAdvisorTargetSchema = z
  .object({
    sourceKey: text.max(200),
    audio: canvasMusicCandidateSchema,
    lyrics: z.string().max(30000),
    creativePrompt: text.max(10000),
    referenceSummaries: z.array(text.max(2000)).max(100),
    referenceKeys: z.array(text.max(5000)).max(100),
    footage: z.array(musicMvSourceClipSchema.extend({ name: text.max(1000) })),
  })
  .strict();
export type MusicMvAdvisorTarget = z.infer<typeof musicMvAdvisorTargetSchema>;

export const musicMvAdvisorProposalSchema = z
  .object({
    kind: z.literal("music_mv_v1"),
    sourceKey: text.max(200),
    evidenceId: z.string().uuid().optional(),
    review: creativeEvidenceReviewSchema.optional(),
    summaryZh: text.max(4000),
    sections: z
      .array(
        z
          .object({
            startSec: z.number().finite().min(0),
            endSec: z.number().finite().positive(),
            labelZh: text.max(100),
            heardZh: text.max(2000),
            emotion: musicEmotionTurnSchema.optional(),
          })
          .strict()
      )
      .min(1),
    uncertaintiesZh: z.array(text.max(2000)),
    concepts: z
      .array(
        z
          .object({
            id: text.max(100),
            titleZh: text.max(200),
            rationaleZh: text.max(2000),
            emotionalArc: musicEmotionArcSchema.optional(),
            openingZh: text.max(1000),
            peakZh: text.max(1000),
            endingZh: text.max(1000),
            plan: canvasMusicMvPlanSchema,
          })
          .strict()
      )
      .length(4),
  })
  .strict();
export type MusicMvAdvisorProposal = z.infer<
  typeof musicMvAdvisorProposalSchema
>;

/** 真实听音结构与全部候选一起验，不把缺段、错歌或伪造素材当可采用方案。 */
export function parseMusicMvAdvisorProposal(
  raw: unknown,
  target: MusicMvAdvisorTarget
): MusicMvAdvisorProposal {
  const value = musicMvAdvisorProposalSchema.parse(
    typeof raw === "string" ? JSON.parse(raw) : raw
  );
  if (
    value.sourceKey !== target.sourceKey ||
    new Set(value.concepts.map(c => c.id)).size !== 4
  )
    throw new Error("MV方案来源或编号不一致");
  let cursor = 0;
  for (const section of value.sections) {
    if (
      Math.abs(section.startSec - cursor) > 0.03 ||
      section.endSec <= section.startSec ||
      section.endSec > target.audio.durationSec + 0.03
    )
      throw new Error("听音段落未连续覆盖歌曲");
    cursor = section.endSec;
  }
  if (Math.abs(cursor - target.audio.durationSec) > 0.03)
    throw new Error("听音报告遗漏歌曲尾部");
  for (const concept of value.concepts) {
    const plan = concept.plan;
    if (
      plan.analysisBasis !== "native_audio" ||
      plan.audioId !== target.audio.id ||
      plan.audioDurationSec !== target.audio.durationSec
    )
      throw new Error("MV方案未绑定本次歌曲听音");
    for (const shot of plan.shots) {
      if (!shot.kind) throw new Error("MV方案缺少镜头制作方式");
      if (
        shot.referenceIndices.some(i => i >= target.referenceSummaries.length)
      )
        throw new Error("人物参考不存在");
      if (
        target.lyrics &&
        shot.lyricQuote &&
        !target.lyrics.includes(shot.lyricQuote)
      )
        throw new Error("方案改写了提供的歌词");
      if (shot.sourceClip) {
        const source = target.footage.find(
          f => f.assetId === shot.sourceClip!.assetId
        );
        if (
          !source ||
          source.url !== shot.sourceClip.url ||
          source.taskId !== shot.sourceClip.taskId ||
          source.durationSec !== shot.sourceClip.durationSec
        )
          throw new Error("方案引用了未提供的素材");
      }
    }
  }
  return value;
}

export const musicMvAdvisorSessionSchema = z
  .object({
    requestId: z.string().uuid(),
    projectId: z.string().uuid().optional(),
    target: musicMvAdvisorTargetSchema,
    question: text.max(1200),
    videoModel: text.max(100),
    status: z.enum(["pending", "succeeded", "failed"]),
    proposal: musicMvAdvisorProposalSchema.optional(),
    adoption: z
      .object({ requestId: z.string().uuid(), conceptId: text.max(100) })
      .strict()
      .optional(),
  })
  .strict();
export type MusicMvAdvisorSession = z.infer<typeof musicMvAdvisorSessionSchema>;

export const canvasMusicMvDraftInputSchema = z
  .object({
    requestId: z.string().uuid(),
    audio: canvasMusicCandidateSchema,
    lyrics: z.string().max(30000).default(""),
    creativePrompt: text.max(10000),
    referenceSummaries: z.array(text.max(2000)).max(100).default([]),
    advisorEvidenceId: z.string().uuid().optional(),
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
  if (plan.analysisBasis === "native_audio" && !input.advisorEvidenceId)
    throw new Error("听音分镜缺少顾问来源证据");
  if (
    plan.audioId !== input.audio.id ||
    plan.audioDurationSec !== input.audio.durationSec
  )
    throw new Error("分镜音乐身份或时长不一致");
  for (const shot of plan.shots) {
    if (
      shot.lyricQuote &&
      (input.lyrics || plan.analysisBasis !== "native_audio") &&
      !input.lyrics.includes(shot.lyricQuote)
    )
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
    editRevisionId: z.string().uuid().optional(),
    alignmentRequestId: z.string().uuid().optional(),
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
    kind: z.enum(["generated", "singing", "footage"]).optional(),
    sourceClip: musicMvSourceClipSchema.optional(),
    audio: canvasMusicCandidateSchema.optional(),
    singingRequestId: z.string().uuid().optional(),
    singingJobId: text.max(200).optional(),
    singingHistory: z
      .array(
        z
          .object({ requestId: z.string().uuid(), jobId: text.max(200) })
          .strict()
      )
      .optional(),
    singingAudio: z
      .object({
        jobId: text,
        gcsUri: text,
        startSec: z.number().finite().min(0),
        endSec: z.number().finite().positive(),
      })
      .strict()
      .optional(),
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
    advisor: musicMvAdvisorSessionSchema.optional(),
    advisorFootageIds: z.array(text.max(200)).optional(),
    advisorHistory: z.array(musicMvAdvisorSessionSchema).optional(),
    timelineEdits: z.array(musicMvEditSessionSchema).optional(),
    songReference: canvasMusicCandidateSchema.optional(),
    songReferenceMediaKind: z.enum(["audio", "video"]).optional(),
    songRequirements: z.string().max(6000).optional(),
    songCraftIds: z.array(z.string()).max(8).optional(),
    creativeLearning: creativeLearningSessionSchema.optional(),
    creativeLearningHistory: z.array(creativeLearningSessionSchema).optional(),
    songAdvisor: sunoSongSessionSchema.optional(),
    songOptimizeExisting: z.boolean().optional(),
    songDemos: z.array(songDemoRunSchema).optional(),
    songOperations: z.array(songOperationSessionSchema).optional(),
    songAlignment: z.object({requestId:z.string().uuid(),sourceId:z.string(),srt:z.string(),words:z.array(songAlignedWordSchema)}).strict().optional(),
    selectedSongDemo: z.object({requestId:z.string().uuid(),variantIndex:z.number().int().nonnegative()}).strict().optional(),
    songAdvisorHistory: z.array(sunoSongSessionSchema).optional(),
    songBrief: sunoSongBriefSchema.optional(),
    songTitle: z.string().max(80).optional(),
    songExcludes: z.string().max(200).optional(),
    songStyleWeight: z.number().min(0).max(1).optional(),
    songWeirdness: z.number().min(0).max(1).optional(),
    songAdoption: z
      .object({
        requestId: z.string().uuid(),
        evidenceId: z.string().uuid(),
        conceptId: z.string(),
        referenceAudioId: z.string().optional(),
      })
      .strict()
      .optional(),
    musicSubmission: sunoSongBriefSchema.optional(),
    songCovers: z.array(songCoverReceiptSchema).optional(),
    musicSubmissionDirection: z.string().max(10000).optional(),
    lyricsCandidateId: text.max(200).optional(),
    candidateContexts: z
      .record(
        text.max(200),
        z
          .object({
            lyrics: z.string().max(30000),
            creativePrompt: z.string().max(10000),
          })
          .strict()
      )
      .optional(),
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
    assembleTerminalStatus: z.enum(["succeeded", "failed"]).optional(),
    assembleHistory: z
      .array(
        z
          .object({
            requestId: z.string().uuid(),
            jobId: text.optional(),
            status: z.enum(["succeeded", "failed"]),
            input: canvasMusicMvAssembleSnapshotSchema.optional(),
            finalBlockId: text.optional(),
          })
          .strict()
      )
      .optional(),
    planTerminalStatus: z.literal("failed").optional(),
    planHistory: z
      .array(
        z
          .object({
            requestId: z.string().uuid(),
            input: canvasMusicMvDraftInputSchema.optional(),
          })
          .strict()
      )
      .optional(),
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
