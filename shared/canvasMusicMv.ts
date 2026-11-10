import { musicMvHighlightSchema } from "./musicMvHighlight";
import {songCoverReceiptSchema} from "./songCover";
import { canvasMusicCandidateSchema } from "./canvasMusicMedia";
import { creativeLearningSessionSchema } from "./creativeGenerationLibrary";
import { musicEmotionTurnSchema, musicEmotionArcSchema } from "./musicEmotion";
import { z } from "zod";
import { concatGradeSchema } from "./colorGrade";
import { videoToolJobRangeSchema, videoToolJobSchema, videoToolJobSubmittingSchema } from "./videoToolJob";
import { creativeEvidenceReviewSchema } from "./creativeEvidenceReview";
import { musicMvEditSessionSchema } from "./canvasMusicMvEdit";
import { songOperationSessionSchema, songAlignedWordSchema } from "./songOperations";
import { MV_SHOT_SCHEMA_MAX_SEC, mvShotReferenceImageSchema, mvShotReferencesSchema } from "./canvasMusicMvReferences";

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

/**
 * 1109 逐窗节拍：MV 创作顾问按歌曲拍点把每镜切成 2–4 秒窗，每窗写表情/视线与动作、景别与运镜、
 * 灯光与氛围、情绪与转折、环境/事件音效；演唱镜另标对口型与对应歌词句。秒位为歌曲绝对秒。
 * 编译器只排版（知识库《ABC带参数成片提示词》A 段），不再从一句分镜机械拆分。
 */
export const musicMvShotBeatSchema = z
  .object({
    startSec: z.number().finite().min(0),
    endSec: z.number().finite().positive(),
    actionZh: text.max(600),
    cameraZh: text.max(400),
    lightingZh: text.max(400),
    moodZh: text.max(300),
    sfxZh: text.max(300),
    /** 本窗人物是否对口型演唱（仅 singing 镜可为 true）。 */
    lipSync: z.boolean().optional(),
    /** 本窗对应的歌词原句（逐字照抄用户歌词）。 */
    lyricZh: z.string().max(500).optional(),
  })
  .strict();
/**
 * 1109 镜头复杂度（顾问逐窗阶段给出）：人数、动作强度、是否有身体接触、机位数、场景数。
 * 达阈值（≥2 人、有明确动作或接触、≥2 机位或 ≥2 场景）→ 该镜站位参考（@视频：白模站位片或实拍运镜片）必填。
 */
export const musicMvShotComplexitySchema = z
  .object({
    people: z.number().int().min(0).max(20),
    action: z.enum(["none", "light", "strong"]),
    contact: z.boolean(),
    cameraSetups: z.number().int().min(1).max(20),
    scenes: z.number().int().min(1).max(20),
  })
  .strict();
export type MusicMvShotComplexity = z.infer<typeof musicMvShotComplexitySchema>;
export function mvShotNeedsStagingReference(c: MusicMvShotComplexity | undefined): boolean {
  if (!c) return false;
  return c.people >= 2 || c.action === "strong" || c.contact || c.cameraSetups >= 2 || c.scenes >= 2;
}
export const MV_SHOT_STAGING_REQUIRED_ZH = "该镜需白模站位或实拍运镜参考";

/**
 * 1109 素材填充段（吟唱区间不对口型）：顾问按情绪与能量给逐窗建议——Pexels 视频直接剪入、
 * Pexels 照片/生成关键帧做推拉、或参考生视频；每个候选带抽屉搜索关键词与理由。
 */
export const MUSIC_MV_FILL_MODES = ["stock_video", "stock_photo", "generated"] as const;
export const musicMvFillCandidateSchema = z
  .object({
    mode: z.enum(MUSIC_MV_FILL_MODES),
    queryEn: text.max(120),
    queryZh: z.string().max(120).optional(),
    cameraZh: text.max(200),
    reasonZh: text.max(300),
  })
  .strict();
export const musicMvFillWindowSchema = z
  .object({
    startSec: z.number().finite().min(0),
    endSec: z.number().finite().positive(),
    moodZh: text.max(200),
    candidates: z.array(musicMvFillCandidateSchema).min(1).max(4),
  })
  .strict();
export type MusicMvFillWindow = z.infer<typeof musicMvFillWindowSchema>;

/** 演唱窗起止的来源：confirmed＝用户确认版歌词时间表；unconfirmed＝自动识别待确认版（仅探针可用，正式出片拦截）。 */
export const MUSIC_MV_LYRIC_TIMING_SOURCES = ["confirmed", "unconfirmed"] as const;
export const musicMvLyricLineSchema = z
  .object({
    text: text.max(300),
    startSec: z.number().finite().min(0),
    endSec: z.number().finite().positive(),
    /** lyric＝真歌词（可对口型）；chant＝吟唱（不对口型，走素材填充）。缺省 lyric。 */
    kind: z.enum(["lyric", "chant"]).optional(),
  })
  .strict();
export type MusicMvLyricLine = z.infer<typeof musicMvLyricLineSchema>;
/** 逐句检查：起止有效、在区间内、按时间先后且不重叠。返回中文问题清单。 */
export function musicMvLyricLineIssues(lines: readonly MusicMvLyricLine[], range: { startSec: number; endSec: number }): string[] {
  const issues: string[] = [];
  let prevEnd = range.startSec;
  lines.forEach((l, i) => {
    if (!(l.endSec > l.startSec)) issues.push(`第${i + 1}句结束时间须晚于开始时间`);
    if (l.startSec < range.startSec - 0.05 || l.endSec > range.endSec + 0.05) issues.push(`第${i + 1}句超出 ${range.startSec}–${range.endSec} 秒区间`);
    if (l.startSec < prevEnd - 0.05) issues.push(`第${i + 1}句与上一句时间重叠或顺序颠倒`);
    prevEnd = Math.max(prevEnd, l.endSec);
  });
  return issues;
}
/**
 * 1109 本段歌词时间表：自动识别（多通道听音，原始/解析 JSON 永久保存）→ 用户逐句改字、改起止、增删 → 确认。
 * 演唱段的 {} 对白秒锁只读 status=confirmed 的版本；未确认不得生成演唱段。
 */
export const musicMvLyricTableSchema = z
  .object({
    requestId: z.string().uuid(),
    audioId: text.max(200),
    range: z.object({ startSec: z.number().finite().min(0), endSec: z.number().finite().positive() }).strict(),
    status: z.enum(["pending", "confirmed"]),
    lines: z.array(musicMvLyricLineSchema).max(300),
    recognizedBy: z.object({ channel: text.max(40), model: text.max(120) }).strict().optional(),
    evidencePrefix: z.string().max(400).optional(),
    editedByUser: z.boolean().optional(),
    confirmedAt: z.string().max(40).optional(),
  })
  .strict()
  .superRefine((t, ctx) => {
    for (const message of musicMvLyricLineIssues(t.lines, t.range)) ctx.addIssue({ code: "custom", message, path: ["lines"] });
  });
export type MusicMvLyricTable = z.infer<typeof musicMvLyricTableSchema>;
export type MusicMvShotBeat = z.infer<typeof musicMvShotBeatSchema>;
export const MUSIC_MV_BEAT_WINDOW_MIN_SEC = 0.5;
export const MUSIC_MV_BEAT_WINDOW_MAX_SEC = 6;
/**
 * 节奏模式：beat＝强节奏，剪点/窗界吸附拍点；phrase＝抒情或节拍不可靠，按乐句与能量峰切，不硬切网格；
 * free＝无稳定节拍，按能量与静音切。自动判定写入 pacing，用户/顾问可写 pacingOverride 覆盖。
 */
export const MUSIC_MV_PACING_MODES = ["beat", "phrase", "free"] as const;
export type MusicMvPacing = (typeof MUSIC_MV_PACING_MODES)[number];
export const musicMvAudioSegmentSchema = z
  .object({
    startSec: z.number().finite().min(0),
    endSec: z.number().finite().positive(),
    /** 0–1：相对全曲最响段的能量。 */
    energy: z.number().finite().min(0).max(1),
    /** 0–1：本段拍点拟合度（拍位起音强度相对均值的周期性）。 */
    beatConfidence: z.number().finite().min(0).max(1),
    pacing: z.enum(MUSIC_MV_PACING_MODES),
    pacingOverride: z.enum(MUSIC_MV_PACING_MODES).optional(),
  })
  .strict();
export type MusicMvAudioSegment = z.infer<typeof musicMvAudioSegmentSchema>;
/**
 * 歌曲 audiomap（唯一节拍分析产物，服务端起音分析一次产出，下游只读不重测）：
 * BPM 以创作说明为准，否则自相关估计；含全曲拍点置信度与分段能量/节奏模式。
 */
export const musicMvBeatGridSchema = z
  .object({
    bpm: z.number().finite().min(40).max(240),
    beatSec: z.number().finite().positive(),
    phaseSec: z.number().finite().min(0),
    source: z.enum(["creative_prompt", "estimated"]),
    beatConfidence: z.number().finite().min(0).max(1).optional(),
    segments: z.array(musicMvAudioSegmentSchema).max(200).optional(),
  })
  .strict();
/** 某时刻的生效节奏模式（覆盖优先；无分段的旧 audiomap 按 beat）。 */
export function musicMvPacingAt(grid: Pick<MusicMvBeatGrid, "segments"> | undefined, sec: number): MusicMvPacing {
  const seg = grid?.segments?.find(s => sec >= s.startSec - 1e-6 && sec < s.endSec + 1e-6);
  return seg ? seg.pacingOverride ?? seg.pacing : "beat";
}
export type MusicMvBeatGrid = z.infer<typeof musicMvBeatGridSchema>;

/** 逐窗节拍终检：从镜头起点连续无缝覆盖到终点；非演唱镜不得标对口型。返回中文问题清单。 */
export function musicMvShotBeatIssues(shot: {
  id: string;
  startSec: number;
  endSec: number;
  kind?: "generated" | "singing" | "footage";
  beats?: MusicMvShotBeat[];
}): string[] {
  const beats = shot.beats;
  if (!beats?.length) return [];
  const issues: string[] = [];
  let cursor = shot.startSec;
  beats.forEach((w, i) => {
    if (Math.abs(w.startSec - cursor) > 0.02) issues.push(`镜头 ${shot.id} 第${i + 1}窗起点 ${w.startSec} 与前窗终点 ${cursor} 不连续`);
    const len = w.endSec - w.startSec;
    if (len + 1e-9 < MUSIC_MV_BEAT_WINDOW_MIN_SEC || len > MUSIC_MV_BEAT_WINDOW_MAX_SEC + 1e-9)
      issues.push(`镜头 ${shot.id} 第${i + 1}窗 ${len.toFixed(2)} 秒，须在 ${MUSIC_MV_BEAT_WINDOW_MIN_SEC}–${MUSIC_MV_BEAT_WINDOW_MAX_SEC} 秒`);
    if (w.lipSync && shot.kind !== "singing") issues.push(`镜头 ${shot.id} 不是对口型镜，第${i + 1}窗不得标对口型`);
    cursor = w.endSec;
  });
  if (Math.abs(cursor - shot.endSec) > 0.02) issues.push(`镜头 ${shot.id} 逐窗终点 ${cursor} 未覆盖到镜头终点 ${shot.endSec}`);
  return issues;
}

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
    /** 1109 逐窗节拍（顾问输出）；旧方案无此字段，编译器按整镜一窗降级。 */
    beats: z.array(musicMvShotBeatSchema).max(12).optional(),
    /** 1109 尾帧接龙：与上一镜连续（同一动作/空间延续），出片时用上一镜尾帧作本镜起幅参考。 */
    continuesFromPrevious: z.boolean().optional(),
    /** 演唱窗起止来源（见 MUSIC_MV_LYRIC_TIMING_SOURCES）。 */
    lyricTiming: z.enum(MUSIC_MV_LYRIC_TIMING_SOURCES).optional(),
    /** 镜头复杂度（达阈值则站位参考必填）。 */
    complexity: musicMvShotComplexitySchema.optional(),
    /** 1109 吟唱区间：本镜走素材填充（不对口型），fill 为顾问逐窗建议。 */
    fillRequested: z.boolean().optional(),
    fill: z.array(musicMvFillWindowSchema).max(12).optional(),
  })
  .strict();
export const canvasMusicMvPlanSchema = z
  .object({
    version: z.literal(1),
    audioId: text.max(200),
    audioDurationSec: z.number().finite().positive().max(3600),
    // 分镜以歌词与创意说明为依据，不伪装已听取音乐或已测定节拍。
    analysisBasis: z.enum(["lyrics_and_user_description", "native_audio"]),
    /** 1109 拍点网格（剪点与窗界吸附依据）；旧方案无此字段。 */
    beatGrid: musicMvBeatGridSchema.optional(),
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
      for (const message of musicMvShotBeatIssues(shot))
        ctx.addIssue({ code: "custom", message, path: ["shots", index, "beats"] });
      // 1109 不锁 15 秒：落库按引擎表最大单段秒数；具体模型在规划（mvShotPlanMaxSec）与出片（单段上限）时另卡
      if (duration + 1e-9 < 0.5 || duration > MV_SHOT_SCHEMA_MAX_SEC + 1e-9)
        ctx.addIssue({
          code: "custom",
          message: `每镜时长必须为 0.5 至 ${MV_SHOT_SCHEMA_MAX_SEC} 秒`,
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
      if (
        target.lyrics &&
        shot.beats?.some(w => w.lyricZh?.trim() && !target.lyrics.includes(w.lyricZh.trim()))
      )
        throw new Error("逐窗节拍改写了提供的歌词");
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
    highlight: musicMvHighlightSchema.optional(),
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
    /** 1109 高光首尾音画同步淡入/淡出（秒）。 */
    videoFadeInSec: z.number().finite().min(0).max(3).optional(),
    videoFadeOutSec: z.number().finite().min(0).max(6).optional(),
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
    /** 1109 参考生视频：主锚图 + 场景图 + 动作参考片 + 歌曲切片；无则不得提交生成。 */
    references: mvShotReferencesSchema.optional(),
    /** 1109 秒锁编译真源：分镜原句、逐窗节拍与拍点网格（出片前按所选模型编译）。 */
    visualPrompt: z.string().max(4000).optional(),
    cameraPrompt: z.string().max(1000).optional(),
    lyricQuote: z.string().max(2000).optional(),
    beats: z.array(musicMvShotBeatSchema).max(12).optional(),
    beatGrid: musicMvBeatGridSchema.optional(),
    /** 尾帧接龙：本镜接上一镜；chainFromUrl 为上一镜成片（出片前抽尾帧作 @图片2 起幅）。 */
    continuesFromPrevious: z.boolean().optional(),
    chainFromUrl: z.string().url().optional(),
    lyricTiming: z.enum(MUSIC_MV_LYRIC_TIMING_SOURCES).optional(),
    /** 演唱段：用户确认版歌词时间表里落在本镜的唱句（歌曲绝对秒）。 */
    lyricLines: z.array(musicMvLyricLineSchema).max(60).optional(),
    complexity: musicMvShotComplexitySchema.optional(),
    fillRequested: z.boolean().optional(),
    fill: z.array(musicMvFillWindowSchema).max(12).optional(),
    /** 1110 角色表（「名称：外形」逐项，取自创作说明）：秒锁编译按角色表生成人物锁，多人可同框。 */
    castZh: z.array(text.max(300)).max(8).optional(),
    /** 1109 场景连续性锁：本镜所在地点名（地点表解析），秒锁编译写进场景行。 */
    sceneLocationZh: text.max(60).optional(),
  })
  .strict();
export type CanvasMusicMvShotBinding = z.infer<
  typeof canvasMusicMvShotBindingSchema
>;

/** 成片超分记录：任务真源在服务端（同源同档幂等、失败退分），这里只存任务号与结果版本。 */
export const canvasMusicMvFinalUpscaleSchema = z
  .object({
    id: z.string().uuid(),
    finalBlockId: text.max(200),
    sourceUrl: z.string().url().max(4000),
    target: z.enum(["2k", "4k"]),
    status: z.enum([
      "submitting",
      "submission_unknown",
      "queued",
      "running",
      "succeeded",
      "failed",
      "timed_out_pending_reconcile",
      "reconcile_manual",
    ]),
    taskId: text.max(200).optional(),
    durationSec: z.number().int().positive().max(600),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    creditsQuoted: z.number().int().nonnegative(),
    creditsUsed: z.number().nonnegative().optional(),
    videoUrl: z.string().url().max(4000).optional(),
    versionBlockId: text.max(200).optional(),
    error: z.string().max(2000).optional(),
  })
  .strict();
export type CanvasMusicMvFinalUpscale = z.infer<
  typeof canvasMusicMvFinalUpscaleSchema
>;

/** 成片调色记录：单片后期 concat（grade 透传）任务号 + 结果版本块；原成片不动。建议先调色再超分。 */
export const canvasMusicMvFinalGradeSchema = z
  .object({
    id: z.string().uuid(),
    finalBlockId: text.max(200),
    sourceUrl: z.string().url().max(4000),
    grade: concatGradeSchema,
    status: z.enum(["submitting", "submission_unknown", "queued", "running", "succeeded", "failed"]),
    jobId: text.max(200).optional(),
    videoUrl: z.string().url().max(4000).optional(),
    versionBlockId: text.max(200).optional(),
    error: z.string().max(2000).optional(),
  })
  .strict();
export type CanvasMusicMvFinalGrade = z.infer<typeof canvasMusicMvFinalGradeSchema>;

/** 成片局部修改记录：任务与计价在服务端（VideoEditPanel 报价确认后提交），这里只存结果与版本块；原成片不动。 */
export const canvasMusicMvFinalEditSchema = z
  .object({
    id: z.string().uuid(),
    finalBlockId: text.max(200),
    sourceUrl: z.string().max(4000),
    jobId: text.max(200),
    videoUrl: z.string().url().max(4000),
    gcsUri: z.string().max(4000).optional(),
    durationSec: z.number().positive().max(3600).optional(),
    editedRange: z.object({ startSec: z.number().min(0), endSec: z.number().positive() }).strict().optional(),
    versionBlockId: text.max(200).optional(),
  })
  .strict();
export type CanvasMusicMvFinalEdit = z.infer<typeof canvasMusicMvFinalEditSchema>;

/** 成片局部修改在途任务：提交成功即记（任务号、请求号、发起时间、实际区间），刷新后据此恢复轮询；完成转入 finalEdits、失败提示后清除。 */
export const canvasMusicMvFinalEditJobSchema = videoToolJobSchema
  .extend({ kind: z.literal("edit"), finalBlockId: text.max(200), range: videoToolJobRangeSchema })
  .strict();
export type CanvasMusicMvFinalEditJob = z.infer<typeof canvasMusicMvFinalEditJobSchema>;
export const MV_FINAL_EDIT_JOBS_MAX = 20;

/**
 * 成片局部修改「提交中」：入队请求发出前先以 requestId 记一条（可能已扣费、还没拿到任务号），
 * 刷新后按 requestId 向服务端核对（任务号由 requestId 决定性派生）：查到补全成在途任务，确认没有这次任务才清除。
 */
export const canvasMusicMvFinalEditSubmittingSchema = videoToolJobSubmittingSchema
  .extend({ finalBlockId: text.max(200), range: videoToolJobRangeSchema })
  .strict();
export type CanvasMusicMvFinalEditSubmitting = z.infer<typeof canvasMusicMvFinalEditSubmittingSchema>;
/** finalEditJobs 的一条：已入队（有任务号，旧草稿只有这一种）或提交中（只有 requestId）。 */
export type CanvasMusicMvFinalEditJobRecord = CanvasMusicMvFinalEditJob | CanvasMusicMvFinalEditSubmitting;

export const isMvFinalEditSubmitting = (r: CanvasMusicMvFinalEditJobRecord): r is CanvasMusicMvFinalEditSubmitting =>
  (r as { status?: unknown }).status === "submitting";

/**
 * 读 / 写 finalEditJobs（宽进严出）：逐条校验，坏条目丢弃、不让整块 MV 草稿判为坏档；旧草稿（只有已入队记录）原样可读。
 * 同任务号只留一条；同 requestId 的提交中只留一条，已有任务号的同请求压过提交中；超限只截留最新的 MV_FINAL_EDIT_JOBS_MAX 条。
 */
export function sanitizeMvFinalEditJobRecords(raw: unknown): CanvasMusicMvFinalEditJobRecord[] {
  if (!Array.isArray(raw)) return [];
  const jobIds = new Set<string>();
  const queuedRequests = new Set<string>();
  const submittingRequests = new Set<string>();
  const out: CanvasMusicMvFinalEditJobRecord[] = [];
  for (const item of raw) {
    const job = canvasMusicMvFinalEditJobSchema.safeParse(item);
    if (job.success) {
      if (jobIds.has(job.data.jobId)) continue;
      jobIds.add(job.data.jobId);
      queuedRequests.add(job.data.requestId);
      out.push(job.data);
      continue;
    }
    const pending = canvasMusicMvFinalEditSubmittingSchema.safeParse(item);
    if (pending.success && !submittingRequests.has(pending.data.requestId)) {
      submittingRequests.add(pending.data.requestId);
      out.push(pending.data);
    }
  }
  const kept = out.filter(r => !isMvFinalEditSubmitting(r) || !queuedRequests.has(r.requestId));
  if (kept.length <= MV_FINAL_EDIT_JOBS_MAX) return kept;
  console.warn(`[canvasMusicMv] finalEditJobs 共 ${kept.length} 条，超过上限 ${MV_FINAL_EDIT_JOBS_MAX}，只保留最新 ${MV_FINAL_EDIT_JOBS_MAX} 条`);
  return kept.slice(-MV_FINAL_EDIT_JOBS_MAX);
}

/** 记 / 刷新「提交中」：同 requestId 已入队则不动；同 requestId 重试只刷新这一条，不另加。 */
export function upsertMvFinalEditSubmitting(raw: unknown, pending: CanvasMusicMvFinalEditSubmitting): CanvasMusicMvFinalEditJobRecord[] {
  const list = sanitizeMvFinalEditJobRecords(raw);
  if (list.some(r => !isMvFinalEditSubmitting(r) && r.requestId === pending.requestId)) return list;
  const at = list.findIndex(r => isMvFinalEditSubmitting(r) && r.requestId === pending.requestId);
  return at < 0 ? sanitizeMvFinalEditJobRecords([...list, pending]) : list.map((r, i) => (i === at ? pending : r));
}

/** 记一条已入队任务（同任务号不重复记）；同 requestId 的「提交中」就地补全为这条，不另加。 */
export function addMvFinalEditJob(raw: unknown, job: CanvasMusicMvFinalEditJob): CanvasMusicMvFinalEditJobRecord[] {
  const list = sanitizeMvFinalEditJobRecords(raw);
  if (list.some(r => !isMvFinalEditSubmitting(r) && r.jobId === job.jobId)) return list;
  const at = list.findIndex(r => isMvFinalEditSubmitting(r) && r.requestId === job.requestId);
  return at < 0 ? sanitizeMvFinalEditJobRecords([...list, job]) : list.map((r, i) => (i === at ? job : r));
}

/** 清掉某条「提交中」；notAfter 给定时只清发起时间不晚于它的（被拒后已用同一 requestId 重试的不清）。 */
export function removeMvFinalEditSubmitting(raw: unknown, requestId: string, notAfter?: number): CanvasMusicMvFinalEditJobRecord[] {
  return sanitizeMvFinalEditJobRecords(raw).filter(
    r => !(isMvFinalEditSubmitting(r) && r.requestId === requestId && (notAfter == null || !(Date.parse(r.startedAt) > notAfter)))
  );
}

/** 成片超分 / 调色 / 局部修改记录各自上限（写入先截留，读入超限也只截留，不整块拒收）。 */
export const MV_FINAL_RECORDS_MAX = 40;

/** 进行中 / 待核对的记录（不能截掉）：有状态且未到终态，或已成功但还没挂上版本块。无状态（局部修改结果）算已完成。 */
export function mvFinalRecordPending(record: unknown): boolean {
  const r = record as { status?: unknown; versionBlockId?: unknown } | null;
  const status = r?.status;
  if (typeof status !== "string") return false;
  if (status === "failed") return false;
  return status !== "succeeded" || !r?.versionBlockId;
}

/**
 * 记录截留（宽进严出）：超过 max 时先丢最旧的已完成项，进行中 / 待核对的不丢（仍超限才丢最旧的进行中项）；其余保持原顺序。
 */
export function capMvFinalRecords<T>(records: readonly T[], max: number, pending: (record: T) => boolean = mvFinalRecordPending): T[] {
  if (records.length <= max) return [...records];
  let excess = records.length - max;
  const drop = new Set<number>();
  for (let i = 0; i < records.length && excess > 0; i++)
    if (!pending(records[i])) {
      drop.add(i);
      excess--;
    }
  for (let i = 0; i < records.length && excess > 0; i++)
    if (!drop.has(i)) {
      drop.add(i);
      excess--;
    }
  return records.filter((_, i) => !drop.has(i));
}

/** 读入时超限截留并 console.warn，不让一个超长数组把整块 MV 草稿判为坏档。 */
function cappedMvRecords<T extends z.ZodTypeAny>(item: T, max: number, field: string, pending?: (record: unknown) => boolean) {
  return z
    .preprocess(raw => {
      if (!Array.isArray(raw) || raw.length <= max) return raw;
      const kept = capMvFinalRecords(raw as unknown[], max, pending);
      console.warn(`[canvasMusicMv] ${field} 共 ${raw.length} 条，超过上限 ${max}，读入只保留 ${kept.length} 条（进行中 / 待核对的不丢）`);
      return kept;
    }, z.array(item).max(max))
    .optional();
}

export const canvasMusicMvStateSchema = z
  .object({
    deliveryMode: z.enum(["song", "highlight"]).optional(),
    highlight: musicMvHighlightSchema.optional(),
    /** 1109 本段歌词时间表（高光区间）；演唱段只读 confirmed 版。 */
    lyricTable: musicMvLyricTableSchema.optional(),
    /** 1109 高光淡入/淡出（秒，音画同步）；缺省按乐句与拍点自动定。 */
    highlightFadeInSec: z.number().finite().min(0).max(3).optional(),
    highlightFadeOutSec: z.number().finite().min(0).max(6).optional(),
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
    /** 1109 全片主锚图（五镜共用）与每镜参考槽位，键为分镜 shot.id。 */
    anchorImage: mvShotReferenceImageSchema.optional(),
    shotReferences: z.record(text.max(100), mvShotReferencesSchema).optional(),
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
    /** 1109 成片超分：复用画布/首页同一超分任务与计价；结果作为新版本块挂在成片旁，原片不动。 */
    finalUpscales: cappedMvRecords(canvasMusicMvFinalUpscaleSchema, MV_FINAL_RECORDS_MAX, "finalUpscales"),
    /** 1109 成片调色：结果作为新版本块挂在成片旁，原片不动。 */
    finalGrades: cappedMvRecords(canvasMusicMvFinalGradeSchema, MV_FINAL_RECORDS_MAX, "finalGrades"),
    /** 1109 成片局部修改：结果作为新版本块挂在成片旁，原片不动。 */
    finalEdits: cappedMvRecords(canvasMusicMvFinalEditSchema, MV_FINAL_RECORDS_MAX, "finalEdits"),
    /** 1110 成片局部修改在途任务（刷新恢复用；完成或失败即清除）。写入已限 20 条，读入超限同样只截留。 */
    /** 1110b 另含「提交中」记录（只有 requestId）；读入逐条校验，坏条目丢弃、超限截留，不整块拒收。 */
    finalEditJobs: z
      .preprocess(
        raw => (raw === undefined ? undefined : sanitizeMvFinalEditJobRecords(raw)),
        z.array(z.union([canvasMusicMvFinalEditJobSchema, canvasMusicMvFinalEditSubmittingSchema])).max(MV_FINAL_EDIT_JOBS_MAX)
      )
      .optional(),
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
