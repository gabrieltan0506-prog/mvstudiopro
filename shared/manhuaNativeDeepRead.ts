/**
 * 原生视频精读产出 → 模板卡的适配器。
 *
 * 上游形状最初来自 0823 实跑，0827 起由 Gemini 3.1 Pro 直读 GCS 视频，
 * 产出完整逐镜、角色调度、表演与音轨证据；本文件是段级证据进入模板卡的契约门。
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
    /** 新产出由 runner 门禁强制必填；optional 仅用于读取历史原始证据。 */
    unitTypeZh: z.enum(["剪辑镜头", "拆分镜证据段"]).optional(),
    shotSizeZh: z.string().trim().optional(),
    angleZh: z.string().trim().optional(),
    compositionZh: z.string().trim().optional(),
    cameraMoveZh: z.string().trim().optional(),
    blockingZh: z.string().trim().optional(),
    bodyActionZh: z.string().trim().optional(),
    limbPropActionZh: z.string().trim().optional(),
    microExpressionZh: z.string().trim().optional(),
    gazeBreathZh: z.string().trim().optional(),
    relationshipReactionZh: z.string().trim().optional(),
    lightingZh: z.string().trim().optional(),
    actionZh: z.string().trim().default(""),
    transitionInZh: z.string().trim().optional(),
    /** 与剧情无关的招商/贴片广告保留在原始时间轴，但不得进入模板证据。 */
    evidenceRole: z.enum(["story", "non_story_ad"]).default("story"),
  })
  .passthrough();

/**
 * 整集卡剔除 non_story_ad 镜头行后的区间账目（绝对秒位）。
 * 完整时间轴仍保留在原始分段卡（Gemini 产物 / raw 证据），供模型完整性验证与审计。
 */
export const nativeDeepReadExcludedAdRangeSchema = z
  .object({
    startSec: z.number().finite().min(0),
    endSec: z.number().finite().min(0),
  })
  .strict()
  .refine((range) => range.endSec > range.startSec, {
    message: "excludedAdRanges 要求 endSec > startSec",
  });

export type NativeDeepReadExcludedAdRange = z.infer<typeof nativeDeepReadExcludedAdRangeSchema>;

/**
 * audioResolution 每个 chunk 的**真实**全片绝对段界（来自 runner 的 segments spec，
 * 不是从镜头 startSec 猜出来的）。音轨局部秒 → 全片绝对秒的唯一合法换算依据。
 */
export const nativeDeepReadAudioChunkSpanSchema = z
  .object({
    chunkIndex: z.number().int().min(0),
    startSec: z.number().finite().min(0),
    endSec: z.number().finite().min(0),
  })
  .strict()
  .refine((span) => span.endSec > span.startSec, {
    message: "chunkSpans 要求 endSec > startSec",
  });

export type NativeDeepReadAudioChunkSpan = z.infer<typeof nativeDeepReadAudioChunkSpanSchema>;

export const nativeDeepReadSegmentSchema = z
  .object({
    shots: z.array(shotSchema).default([]),
    /** 可选：整集卡合并层整行剔除广告镜头后留下的区间账目；无广告时缺省不出现。 */
    excludedAdRanges: z.array(nativeDeepReadExcludedAdRangeSchema).optional(),
    /**
     * 重点时刻（v12 新增，**可选**）：由**正在逐秒看片的模型**自报的抓帧秒位。
     *
     * 为什么必须模型自报：抽帧长期「牛头不对马嘴」的根因是 ffmpeg 只能按镜头区间取
     * 机械中点，而中点常落在转场、运动模糊或空镜上；「微表情峰值在第几秒」这种判断
     * 只有看得见画面的模型知道。ffmpeg 判得了黑帧，判不了戏。
     *
     * 五类与审片报告的抽帧六原则一一对应：
     *   切镜=景别/机位突变必抽 · 情绪=强微表情定点 · 灯光=氛围切换成对抽
     *   剧情=关键节点 · 音轨=声音事件 cue
     *
     * 可选（不进硬门禁）：旧卡没有这个字段，下游一律兜底，缺省即退回原有抽帧策略。
     */
    /**
     * ⚠️ 用 passthrough + catch，**绝不能是硬失败项**（0830 审查 P1-2）：
     * 本 schema 的 safeParse 是 runner 仅存的硬失败门禁之一，失败即整段重试、
     * 用尽温度梯度仍不落地。若这里用 .strict()+min(1)，模型多吐一个键、
     * 或某条 noteZh 是空串，就会**弄死一整段已付费的 shots/音轨证据**——
     * 为一个下游可选字段赔上整段产出，代价完全不成比例。
     * 参照 shotSchema 用 .passthrough() 正是同一个道理。
     * 非法条目由 runner 过滤成 advisory，不进硬门。
     */
    keyMoments: z.array(z.object({
      atSec: z.number().finite().min(0),
      kindZh: z.string().trim().min(1),
      noteZh: z.string().trim(),
    }).passthrough()).optional().catch([]),
    subtitles: z.array(z.object({
      atSec: z.number().finite().min(0),
      textZh: z.string().trim().min(1),
    }).strict()).default([]),
    audioResolution: z.array(z.object({
      chunkIndex: z.number().int().min(0),
      analysis: manhuaNativeAudioChunkAnalysisSchema,
    }).strict()).default([]),
    /**
     * 可选：runner 注入的 audioResolution 各 chunk 真实段界（与 shots 同坐标系的
     * 全片绝对秒）。旧卡没有这个字段——那时音频广告过滤必须跳过并打标记，
     * 绝不允许退回「min(shot.startSec) 猜起点」或「chunkIndex*300」。
     */
    chunkSpans: z.array(nativeDeepReadAudioChunkSpanSchema).optional(),
    /** runner 段门禁写入的改进建议；随段卡持久化，整集卡合并时汇总。 */
    advisories: z.array(z.object({
      code: z.string().trim().min(1),
      detailZh: z.string().trim().min(1),
      segmentIndex: z.number().int().min(0).optional(),
    }).strict()).optional(),
    /**
     * 上游 finishReason=MAX_TOKENS 时由 runner 写入并随段卡持久化。
     *
     * 必须落进段卡本体：只靠外层信封的 finish 字段，缓存命中与断点恢复后
     * 截断标记就凭空消失了（advisory 文案还在，结构化字段却恒为 false）。
     */
    truncated: z.boolean().optional(),
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

/**
 * 段级改进建议（0829 用户拍板「全收＋标注＋GLM 收口」取代「拒收重买」）。
 *
 * 旧口径把密度/覆盖不足当拒收条件，实证一集 6 段拒收重买 3 段、白烧 ¥20.5，
 * 而被拒响应本身内容完整。现在这类判定一律降级成 advisory 随卡返回：
 * `segmentIndex` 让面板按段聚合，`detailZh` 必须写出具体数字或秒位缺口，
 * 由人一眼看到「本段仅 28 镜 / 音轨 1 段 / 覆盖缺 50 秒」自行决定是否重跑。
 */
export type NativeDeepReadAdvisory = {
  code: string;
  detailZh: string;
  segmentIndex?: number;
};

/**
 * advisory 去重：同一条建议会从段卡、段级门禁、集级门禁三处汇进来，
 * 不去重面板上就是同一句话刷三遍。按 code + segmentIndex + detailZh 判同。
 * 顺序按段号稳定排序，段号缺失的排在最后（不改写它们的相对顺序）。
 */
export function dedupeNativeDeepReadAdvisories(
  rows: readonly NativeDeepReadAdvisory[],
): NativeDeepReadAdvisory[] {
  const seen = new Set<string>();
  const out: NativeDeepReadAdvisory[] = [];
  for (const row of rows) {
    const code = String(row?.code || "").trim();
    const detailZh = String(row?.detailZh || "").trim();
    if (!code || !detailZh) continue;
    const segmentIndex = Number.isInteger(row?.segmentIndex) ? row.segmentIndex : undefined;
    const key = `${code}\u0000${segmentIndex ?? ""}\u0000${detailZh}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(segmentIndex === undefined ? { code, detailZh } : { code, detailZh, segmentIndex });
  }
  return out.sort((a, b) => {
    const left = a.segmentIndex ?? Number.MAX_SAFE_INTEGER;
    const right = b.segmentIndex ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });
}

/** 模型自报的抓帧时刻（v12）。atSec 是全片绝对秒。 */
export type NativeDeepReadKeyMoment = {
  atSec: number;
  kindZh: string;
  noteZh: string;
};

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
  /**
   * 重点时刻（v12）：模型看片时自报的抓帧秒位表，五类＝切镜/情绪/灯光/剧情/音轨。
   * 抽帧链据此取帧，取代「按镜头区间取机械中点」——中点常落在转场、运动模糊或空镜上。
   * 真人剧尤其吃这一条：它的价值在导演手法、灯光氛围、运镜与表演，
   * 而这些恰好就是切镜/灯光/情绪三类要点名的时刻。
   */
  keyMoments?: NativeDeepReadKeyMoment[];
  /** 解析到的段数与镜头总数，供落库时记进 provenance */
  segmentCount: number;
  shotCount: number;
  /** 被丢弃的段数：failed / finish=length / 非法 JSON —— producer 必须检查 */
  failedSegmentCount: number;
  /** 被丢弃的镜头数：动作或节奏结构为空。**不写「未标注」占位**，空就是没学到 */
  droppedCount: number;
  /**
   * 上游 finishReason=MAX_TOKENS 时保留可用前缀即置 true（0829 起不再整段丢弃）。
   * 没有截断段时为 false。
   */
  truncated: boolean;
  /**
   * 段级改进建议汇总（按 segmentIndex 聚合）；无建议时缺省不出现。
   * 消费层（面板/审片报告/provenance）据此显示「本段仅 N 镜」等提示，不阻断入库。
   */
  advisories?: NativeDeepReadAdvisory[];
  /** 同一集音轨的故事/对白/声音节奏；由执行协调器在视觉精读后装配。 */
  audioAnalysis?: ManhuaNativeAudioAnalysis;
  /** 整集卡剔除广告镜头行后的区间账目原样透传（全片绝对秒）；无广告时缺省。 */
  excludedAdRanges?: NativeDeepReadExcludedAdRange[];
  /**
   * 仅当「存在广告区间但某个 audioResolution chunk 没有真实段界（旧卡无 chunkSpans）」
   * 时为 true：该 chunk 的音轨广告过滤被跳过、原样保留，供消费层显式知晓。
   * 有真实段界或根本没有广告区间时缺省不出现。绝不用猜的偏移错删。
   */
  audioAdFilterSkipped?: boolean;
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
  const parsedRows = rows.map((row, sourceIndex) => {
    const outer = (row || {}) as {
      text?: unknown;
      startSec?: unknown;
      failed?: unknown;
      finish?: unknown;
    };
    if (outer.failed) return null;
    // 0829 起 finish=length（上游截断）不再整段丢弃：前半内容是已付费的有效证据，
    // 能解析就保留并打 truncated 标记，由 advisory 告诉人「这段缺尾」。
    const outerTruncated = String(outer.finish || "") === "length"
      || String(outer.finish || "").toUpperCase() === "MAX_TOKENS";
    const rawInner = typeof outer.text === "string" ? safeJson(outer.text) : outer.text;
    if (!rawInner) return null;
    const seg = nativeDeepReadSegmentSchema.safeParse(rawInner);
    if (!seg.success) return null;
    return {
      // 真实段号取**入参下标**，不是过滤后数组的下标：seg0 失败时，
      // 用过滤后下标会把 seg1 的提示挂到「第1段」，advisory 全体错位。
      sourceIndex,
      seg: seg.data,
      offsetSec: Math.max(0, Math.floor(Number(outer.startSec) || 0)),
      truncated: outerTruncated || seg.data.truncated === true,
    };
  });
  const ok = parsedRows.filter(Boolean) as Array<{
    sourceIndex: number;
    seg: NativeDeepReadSegment;
    offsetSec: number;
    truncated: boolean;
  }>;
  // 段卡自带的 advisory 原样汇总；截断段补一条 truncated（段卡里已有就不重复补）。
  const advisories: NativeDeepReadAdvisory[] = dedupeNativeDeepReadAdvisories(
    ok.flatMap(({ seg, truncated, sourceIndex }) => {
      const own = (seg.advisories ?? []).map((row) => ({
        ...row,
        segmentIndex: Number.isInteger(row.segmentIndex) ? row.segmentIndex : sourceIndex,
      }));
      const alreadyMarked = own.some((row) => row.code === "truncated");
      return [
        ...own,
        ...(truncated && !alreadyMarked
          ? [{
            code: "truncated",
            detailZh: `第${sourceIndex + 1}段上游输出被截断，已保留可解析前缀（镜头表可能缺尾）`,
            segmentIndex: sourceIndex,
          }]
          : []),
      ];
    }),
  );

  let droppedCount = 0;
  const allBeats: ManhuaViralTemplateBeat[] = ok.flatMap(({ seg, offsetSec }) => {
    const conflictZh = String(seg.beatStructureZh || "").trim().slice(0, 40);
    return seg.shots.flatMap((shot) => {
      if (shot.evidenceRole === "non_story_ad") return [];
      const visualZh = String(shot.actionZh || "").trim().slice(0, 280);
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
          unitTypeZh: shot.unitTypeZh,
          shotSizeZh: cut(shot.shotSizeZh, 32),
          angleZh: cut(shot.angleZh, 32),
          compositionZh: cut(shot.compositionZh, 160),
          cameraMoveZh: cut(shot.cameraMoveZh, 220),
          blockingZh: cut(shot.blockingZh, 220),
          bodyActionZh: cut(shot.bodyActionZh, 220),
          limbPropActionZh: cut(shot.limbPropActionZh, 220),
          microExpressionZh: cut(shot.microExpressionZh, 220),
          gazeBreathZh: cut(shot.gazeBreathZh, 180),
          relationshipReactionZh: cut(shot.relationshipReactionZh, 200),
          lightingZh: cut(shot.lightingZh, 220),
          transitionInZh: cut(shot.transitionInZh, 140),
        } satisfies ManhuaViralTemplateBeat,
      ];
    });
  });

  // 完整证据在生产、解析、存储与消费层一镜不少；任何层都不得固定抽稀。
  const beatGrid = allBeats;

  const subtitleTrack = ok
    .flatMap(({ seg, offsetSec }) => {
      const adIntervals = [
        ...seg.shots
          .filter((shot) => shot.evidenceRole === "non_story_ad")
          .map((shot) => ({ startSec: shot.startSec, endSec: shot.endSec })),
        // 整集卡已整行剔除广告镜头时，广告区间只存在于 excludedAdRanges 账目里。
        ...(seg.excludedAdRanges ?? []),
      ];
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
  // 广告区间的声音同样不得进入消费层：音轨行整段落在广告区间内的删除，
  // 跨界行保留但剔除落在广告区间内的 cues。
  // 换算铁律：chunk 内局部秒 + **该 chunk 的真实段界起点（chunkSpans）** = 全片绝对秒。
  // 禁止用 min(shot.startSec) 猜起点、禁止 chunkIndex*300；旧卡缺 chunkSpans 时
  // 跳过过滤并置 audioAdFilterSkipped，绝不用猜的偏移错删。
  const resolvedByChunk = new Map<number, ManhuaNativeAudioChunkAnalysis>();
  let audioAdFilterSkipped = false;
  for (const { seg } of ok) {
    const adIntervals = [
      ...seg.shots
        .filter((shot) => shot.evidenceRole === "non_story_ad")
        .map((shot) => ({ startSec: shot.startSec, endSec: shot.endSec })),
      ...(seg.excludedAdRanges ?? []),
    ];
    const spanByChunk = new Map<number, NativeDeepReadAudioChunkSpan>(
      (seg.chunkSpans ?? []).map((span) => [span.chunkIndex, span]),
    );
    const inAd = (absSec: number) =>
      adIntervals.some((interval) => absSec >= interval.startSec && absSec < interval.endSec);
    for (const row of seg.audioResolution) {
      if (resolvedByChunk.has(row.chunkIndex)) continue;
      if (!adIntervals.length) {
        resolvedByChunk.set(row.chunkIndex, row.analysis);
        continue;
      }
      const span = spanByChunk.get(row.chunkIndex);
      if (!span) {
        audioAdFilterSkipped = true;
        resolvedByChunk.set(row.chunkIndex, row.analysis);
        continue;
      }
      const chunkStart = span.startSec;
      resolvedByChunk.set(row.chunkIndex, {
        ...row.analysis,
        audioTrack: row.analysis.audioTrack
          .filter((track) => !adIntervals.some((interval) =>
            chunkStart + track.fromSec >= interval.startSec
            && chunkStart + track.toSec <= interval.endSec))
          .map((track) => ({
            ...track,
            cues: track.cues.filter((cue) => !inAd(chunkStart + cue.atSec)),
          })),
      });
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

  // 整集卡上的广告区间账目只作透传，不参与本层过滤（消费层剔除逻辑不变）。
  const excludedAdRanges = ok
    .flatMap(({ seg, offsetSec }) => (seg.excludedAdRanges ?? []).map((range) => ({
      startSec: offsetSec + range.startSec,
      endSec: offsetSec + range.endSec,
    })))
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);

  /**
   * 重点时刻（v12）：段内秒位换算成全片绝对秒后按 atSec 排序，同秒同类去重。
   * 广告区间内的时刻整条剔除——广告零帧是抽帧铁律。
   * 非法条目（秒位不在本段区间内、类型不在五类内）**静默丢弃并记 advisory**，
   * 绝不抛错：这是可选字段，不该有弄死整段付费产出的杀伤力。
   */
  const KEY_MOMENT_KINDS = new Set(["切镜", "情绪", "灯光", "剧情", "音轨"]);
  const keyMomentSeen = new Set<string>();
  let keyMomentDropped = 0;
  const keyMoments: NativeDeepReadKeyMoment[] = ok
    .flatMap(({ seg, offsetSec }) => {
      // 🔒 与镜头用**同一套换算**（offsetSec + 段内秒），否则我们自己就在制造串号。
      // 合法区间取该段自己的镜头范围——自洽，不依赖外部 span 字段。
      const segShots = seg.shots ?? [];
      /**
       * 🔴 广告零帧必须挡**两个来源**（0830 用户点破 + 审查 P2）：
       * `excludedAdRanges` 是**整集卡**才有的区间账目；段卡阶段广告只表现为
       * `evidenceRole === "non_story_ad"`。只挡前者 ⇒ 走段卡时广告帧照样进抽帧包。
       * 而广告在画面上恰恰满足「切镜/灯光/剧情」的表面特征，最容易被误点成重点时刻。
       * 同文件的音轨与字幕本来就是两个来源都挡，这里对齐它们。
       */
      const segAdSpans = segShots
        .filter((x) => x.evidenceRole === "non_story_ad")
        .map((x) => ({ startSec: Number(x.startSec), endSec: Number(x.endSec) }))
        .filter((x) => Number.isFinite(x.startSec) && Number.isFinite(x.endSec));
      const lo = segShots.length ? Math.min(...segShots.map((x) => Number(x.startSec))) : 0;
      const hi = segShots.length ? Math.max(...segShots.map((x) => Number(x.endSec))) : 0;
      return (seg.keyMoments ?? []).flatMap((moment) => {
      const local = Number(moment.atSec);
      const atSec = offsetSec + local;
      const kindZh = String(moment.kindZh || "").trim();
      // 与音轨同响应但坐标系不同（音轨用局部秒），模型极易串号——越界即判非法。
      const inSpan = Number.isFinite(local) && segShots.length > 0
        && local >= lo - 0.5 && local <= hi + 0.5;
      if (!inSpan || !KEY_MOMENT_KINDS.has(kindZh)) { keyMomentDropped += 1; return []; }
      // 半开区间：shots 连续无空档 ⇒ 广告 endSec **恒等于**下一条正片的 startSec，
      // 用闭区间会把「广告结束那一秒＝正片第一帧」这个最该抓的时刻当广告剔掉。
      // 与同文件音轨过滤 inAd 的 `>= start && < end` 对齐。
      if (segAdSpans.some((r) => local >= r.startSec && local < r.endSec)) return [];
      if (excludedAdRanges.some((r) => atSec >= r.startSec && atSec <= r.endSec)) return [];
      const key = `${Math.round(atSec)}|${kindZh}`;
      if (keyMomentSeen.has(key)) return [];
      keyMomentSeen.add(key);
      return [{ atSec, kindZh, noteZh: cut(moment.noteZh, 120) || "" }];
      });
    })
    .sort((a, b) => a.atSec - b.atSec);
  if (keyMomentDropped > 0) {
    advisories.push({
      code: "key_moments_invalid_dropped",
      detailZh: `重点时刻有 ${keyMomentDropped} 条秒位越界或类型非法，已丢弃（抽帧将退回镜头区间策略）`,
    });
  }

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
    keyMoments: keyMoments.length ? keyMoments : undefined,
    segmentCount: ok.length,
    shotCount: beatGrid.length,
    failedSegmentCount: rows.length - ok.length,
    droppedCount,
    truncated: ok.some((row) => row.truncated),
    advisories: advisories.length ? advisories : undefined,
    excludedAdRanges: excludedAdRanges.length ? excludedAdRanges : undefined,
    ...(audioAdFilterSkipped ? { audioAdFilterSkipped: true } : {}),
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
