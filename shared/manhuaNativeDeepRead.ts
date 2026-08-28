/**
 * 原生视频精读产出 → 模板卡的适配器。
 *
 * 上游形状来自 0823 实跑（qwen3.8-max 直读抖音 CDN，逐镜六栏），
 * 每段一条记录，`text` 里是模型返回的 JSON 字符串：
 *
 * ```
 * { seg, startSec, endSec, hint, usage, finish, shots, text }
 *                                                       └→ { shots[], beatStructureZh,
 *                                                            moodArcZh, reusableZh, genPromptHintZh }
 * ```
 *
 * 实测规模：262 秒素材 → 6 段 → 95 个镜头（`~/Downloads/2026Aug23/学习产出/deep-6seg.json`）。
 *
 * ⚠️ 本模块只做「解析与映射」。**接进学习服务主流程是另一件事**——
 * 生产链路目前仍走抽帧（frame_vision_deterministic），原生精读还没接进去。
 */
import { z } from "zod";
import type {
  ManhuaViralTemplateBeat,
  ManhuaViralTemplateClassification,
} from "./manhuaViralTemplateBank.js";
import {
  manhuaNativeAudioChunkAnalysisSchema,
  type ManhuaNativeAudioAnalysis,
  type ManhuaNativeAudioChunkAnalysis,
} from "./manhuaNativeAudioAnalysis.js";

const shotSchema = z
  .object({
    startSec: z.number().min(0),
    endSec: z.number().min(0),
    shotSizeZh: z.string().trim().optional(),
    angleZh: z.string().trim().optional(),
    cameraMoveZh: z.string().trim().optional(),
    lightingZh: z.string().trim().optional(),
    actionZh: z.string().trim().default(""),
    transitionInZh: z.string().trim().optional(),
    /** 与剧情无关的招商/贴片广告保留在原始时间轴，但不得进入模板证据。 */
    evidenceRole: z.enum(["story", "non_story_ad"]).default("story"),
  })
  .passthrough();

export const nativeDeepReadSegmentSchema = z
  .object({
    shots: z.array(shotSchema).default([]),
    subtitles: z.array(z.object({
      atSec: z.number().finite().min(0),
      textZh: z.string().trim().min(1),
    }).strict()).default([]),
    audioResolution: z.array(z.object({
      chunkIndex: z.number().int().min(0),
      analysis: manhuaNativeAudioChunkAnalysisSchema,
    }).strict()).default([]),
    beatStructureZh: z.string().trim().default(""),
    moodArcZh: z.string().trim().optional(),
    reusableZh: z.string().trim().optional(),
    genPromptHintZh: z.string().trim().optional(),
    classification: z.object({
      emotionTagsZh: z.array(z.string().trim().min(1)).default([]),
      narrativeFeatureTagsZh: z.array(z.string().trim().min(1)).default([]),
      performanceTagsZh: z.array(z.string().trim().min(1)).default([]),
      audiovisualTagsZh: z.array(z.string().trim().min(1)).default([]),
      audienceExperienceTagsZh: z.array(z.string().trim().min(1)).default([]),
    }).strict().optional(),
  })
  .passthrough();

export type NativeDeepReadSegment = z.infer<typeof nativeDeepReadSegmentSchema>;

export type NativeDeepReadOutput = {
  beatGrid: ManhuaViralTemplateBeat[];
  /** 画面 OCR 得到的原文字幕；只作内部证据与审批展示，不直接复制进新剧本。 */
  subtitleTrack: Array<{ atSec: number; textZh: string }>;
  /** 新加坡视频 Qwen 对照真画面后裁决的段内音轨；保留 chunkIndex，禁止按数组位置猜身份。 */
  resolvedAudioChunks: Array<{ chunkIndex: number; analysis: ManhuaNativeAudioChunkAnalysis }>;
  reusableZh?: string;
  genPromptHintZh?: string;
  classification?: ManhuaViralTemplateClassification;
  /**
   * 情绪推进与节奏结构（0824 接出）。
   *
   * 这两栏 schema 一直在解析，却没进过输出——落库时卡片的 summaryZh / hook3sZh
   * 就只能靠拼装编出来。接出来之后，卡面上那两行是**真学到的**，不是模板话术。
   */
  moodArcZh?: string;
  beatStructureZh?: string;
  /** 解析到的段数与镜头总数，供落库时记进 provenance */
  segmentCount: number;
  shotCount: number;
  /** 被丢弃的段数：failed / finish=length / 非法 JSON —— producer 必须检查 */
  failedSegmentCount: number;
  /** 被丢弃的镜头数：动作或节奏结构为空。**不写「未标注」占位**，空就是没学到 */
  droppedCount: number;
  /** 兼容旧产物：新链路不再截断完整镜头证据，因此恒为 false。 */
  truncated: boolean;
  /** 同一集音轨的故事/对白/声音节奏；由执行协调器在视觉精读后装配。 */
  audioAnalysis?: ManhuaNativeAudioAnalysis;
};

const cut = (v: string | undefined, max: number): string | undefined => {
  const t = String(v || "").trim().slice(0, max);
  return t || undefined;
};

/**
 * 逐段解析 → 拼成完整 beatGrid。
 *
 * `atSec` 用**全片绝对秒**（段起点 + 镜内相对秒），否则多段拼起来时间戳会重叠，
 * 编剧注入时按 atSec 排序就乱了。
 */
export function mapNativeDeepReadSegments(rows: readonly unknown[]): NativeDeepReadOutput {
  const parsed = rows.map((row) => {
    const outer = (row || {}) as {
      text?: unknown;
      startSec?: unknown;
      failed?: unknown;
      finish?: unknown;
    };
    if (outer.failed) return null;
    // finish=length 表示上游被截断，这一段的镜头必然不全，整段丢弃比留半截安全
    if (String(outer.finish || "") === "length") return null;
    const rawInner = typeof outer.text === "string" ? safeJson(outer.text) : outer.text;
    if (!rawInner) return null;
    const seg = nativeDeepReadSegmentSchema.safeParse(rawInner);
    if (!seg.success) return null;
    return { seg: seg.data, offsetSec: Math.max(0, Math.floor(Number(outer.startSec) || 0)) };
  });
  const ok = parsed.filter(Boolean) as Array<{ seg: NativeDeepReadSegment; offsetSec: number }>;

  let droppedCount = 0;
  const allBeats: ManhuaViralTemplateBeat[] = ok.flatMap(({ seg, offsetSec }) => {
    const conflictZh = String(seg.beatStructureZh || "").trim().slice(0, 40);
    return seg.shots.flatMap((shot) => {
      if (shot.evidenceRole === "non_story_ad") return [];
      const visualZh = String(shot.actionZh || "").trim().slice(0, 80);
      // 空值不写「未标注」占位：占位会让下游以为学到了东西，实际是空的
      if (!conflictZh || !visualZh) {
        droppedCount += 1;
        return [];
      }
      const start = offsetSec + Math.floor(Number(shot.startSec) || 0);
      const end = offsetSec + Math.floor(Number(shot.endSec) || 0);
      return [
        {
          atSec: Math.max(0, start),
          endSec: end > start ? end : undefined,
          conflictZh,
          visualZh,
          shotSizeZh: cut(shot.shotSizeZh, 16),
          angleZh: cut(shot.angleZh, 16),
          cameraMoveZh: cut(shot.cameraMoveZh, 60),
          lightingZh: cut(shot.lightingZh, 60),
          transitionInZh: cut(shot.transitionInZh, 20),
        } satisfies ManhuaViralTemplateBeat,
      ];
    });
  });

  // 完整证据在生产、解析、存储与消费层一镜不少；任何层都不得固定抽稀。
  const beatGrid = allBeats;

  const subtitleTrack = ok
    .flatMap(({ seg, offsetSec }) => {
      const adIntervals = seg.shots
        .filter((shot) => shot.evidenceRole === "non_story_ad")
        .map((shot) => ({ startSec: shot.startSec, endSec: shot.endSec }));
      return seg.subtitles.flatMap((subtitle) => {
        const atSec = Math.max(0, subtitle.atSec);
        if (adIntervals.some((interval) => atSec >= interval.startSec && atSec < interval.endSec)) {
          return [];
        }
        return [{
          atSec: Math.round((offsetSec + atSec) * 100) / 100,
          textZh: String(subtitle.textZh || "").trim().slice(0, 160),
        }];
      });
    })
    .filter((subtitle) => subtitle.textZh)
    .sort((a, b) => a.atSec - b.atSec);
  const resolvedByChunk = new Map<number, ManhuaNativeAudioChunkAnalysis>();
  for (const { seg } of ok) {
    for (const row of seg.audioResolution) {
      if (!resolvedByChunk.has(row.chunkIndex)) resolvedByChunk.set(row.chunkIndex, row.analysis);
    }
  }
  const resolvedAudioChunks = Array.from(resolvedByChunk.entries())
    .sort(([a], [b]) => a - b)
    .map(([chunkIndex, analysis]) => ({ chunkIndex, analysis }));

  const joinField = (pick: (s: NativeDeepReadSegment) => string | undefined) =>
    cut(
      ok
        .map(({ seg }) => String(pick(seg) || "").trim())
        .filter(Boolean)
        .join("；"),
      600,
    );
  const mergeTags = (
    pick: (classification: NonNullable<NativeDeepReadSegment["classification"]>) => string[],
  ) => Array.from(new Set(ok.flatMap(({ seg }) => seg.classification ? pick(seg.classification) : [])))
    .map((tag) => String(tag || "").trim().slice(0, 24))
    .filter(Boolean);
  const classification: ManhuaViralTemplateClassification = {
    emotionTagsZh: mergeTags((row) => row.emotionTagsZh),
    narrativeFeatureTagsZh: mergeTags((row) => row.narrativeFeatureTagsZh),
    performanceTagsZh: mergeTags((row) => row.performanceTagsZh),
    audiovisualTagsZh: mergeTags((row) => row.audiovisualTagsZh),
    audienceExperienceTagsZh: mergeTags((row) => row.audienceExperienceTagsZh),
  };

  return {
    beatGrid,
    subtitleTrack,
    resolvedAudioChunks,
    reusableZh: joinField((s) => s.reusableZh),
    genPromptHintZh: joinField((s) => s.genPromptHintZh),
    classification: Object.values(classification).some((tags) => tags.length)
      ? classification
      : undefined,
    moodArcZh: joinField((s) => s.moodArcZh),
    beatStructureZh: joinField((s) => s.beatStructureZh),
    segmentCount: ok.length,
    shotCount: beatGrid.length,
    failedSegmentCount: rows.length - ok.length,
    droppedCount,
    truncated: false,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // 模型偶尔裹 Markdown 围栏，剥掉再试一次
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}
