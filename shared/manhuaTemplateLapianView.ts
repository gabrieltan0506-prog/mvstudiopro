/**
 * 模板学习 · 拉片式派生视图（站长专用，漫剧创作参考）。
 *
 * 只读已入库学习卡里的现成证据，用确定性函数重组成拉片的呈现方式：
 * 镜头构造表（逐镜全量）、分段计划、段证据包、视觉频次统计。
 * 缺的「创作判词」部分（复刻提示词、视觉基因六维）由服务端一次文字模型调用补齐，
 * 输出直接复用拉片契约 `shared/videoBreakdown.ts` 的子 schema 与格式函数，不另造格式。
 *
 * 不改精读契约：本文件不读也不写精读提示词 / schema / 段缓存指纹；派生产物单独版本号，不写回学习卡。
 * 证据完整性：每一镜都进且只进一段、一行；不抽样、不合并、不截断（测试断言条数进 = 出）。
 */
import { z } from "zod";
import type { ManhuaViralTemplateBeat, ManhuaViralTemplateCard } from "./manhuaViralTemplateBank";
import {
  formatVideoBreakdownRecreatePrompt,
  videoBreakdownRecreatePromptSchema,
  videoBreakdownSchema,
  videoBreakdownVisualGenesSchema,
  type VideoBreakdownSegment,
} from "./videoBreakdown";

/** 派生版本：分段规则、证据包形状或提示词变了就升级，旧派生产物原样保留不覆盖。 */
export const MANHUA_TEMPLATE_LAPIAN_VERSION = "tpl_lapian_v1";
/** 段目标时长与上限（上限 40 镜 = 拉片 recreatePrompt.timeline 的 40 窗上限）。 */
export const MANHUA_TEMPLATE_LAPIAN_TARGET_SEC = 60;
export const MANHUA_TEMPLATE_LAPIAN_MAX_SHOTS = 40;
export const MANHUA_TEMPLATE_LAPIAN_MIN_TAIL_SEC = 20;
/** 与拉片 validateVideoBreakdownTiming 同一容差。 */
export const MANHUA_TEMPLATE_LAPIAN_TOLERANCE_SEC = 0.35;

type LapianCard = Pick<ManhuaViralTemplateCard, "id" | "beatGrid" | "audioStory" | "evidenceFrames" | "provenance" | "reusableZh" | "genPromptHintZh" | "classification">;

const r1 = (n: number) => Math.round(n * 10) / 10;
const clean = (v: unknown) => String(v ?? "").trim();
const dash = (v: string) => v || "—";

// ─── 镜头构造表 ────────────────────────────────────────

export type ManhuaTemplateShotRow = {
  /** 在 beatGrid 中的原始下标（0 起），用于和学习卡逐镜对账。 */
  index: number;
  startSec: number;
  /** 精读逐镜才有；塌缩镜 / 抽帧卡没有，显示为单点时间。 */
  endSec: number | null;
  /** 画面景别 */
  framing: string;
  /** 摄影机：机位角度 + 运镜 */
  camera: string;
  /** 调度 · 构图与焦点：构图 + 站位调度 */
  blockingAndFocus: string;
  /** 进入本镜的转场（有才有） */
  transitionIn?: string;
  unitType?: string;
};

/** 逐镜一行，原序、全量。空字段显示「—」，只是展示占位，不写回学习卡。 */
export function buildManhuaTemplateShotTable(card: Pick<ManhuaViralTemplateCard, "beatGrid">): ManhuaTemplateShotRow[] {
  return (card.beatGrid || []).map((beat, index) => {
    const angle = clean(beat.angleZh);
    const move = clean(beat.cameraMoveZh);
    const composition = clean(beat.compositionZh);
    const blocking = clean(beat.blockingZh);
    const end = Number(beat.endSec);
    const row: ManhuaTemplateShotRow = {
      index,
      startSec: r1(Number(beat.atSec) || 0),
      endSec: Number.isFinite(end) && end > Number(beat.atSec) ? r1(end) : null,
      framing: dash(clean(beat.shotSizeZh)),
      camera: dash([angle, move].filter(Boolean).join("；")),
      blockingAndFocus: dash([composition, blocking].filter(Boolean).join("；")),
    };
    if (clean(beat.transitionInZh)) row.transitionIn = clean(beat.transitionInZh);
    if (beat.unitTypeZh) row.unitType = beat.unitTypeZh;
    return row;
  });
}

/** 学习卡片长：优先 provenance 的源片长，其次分片终点，最后最晚镜头终点。 */
export function manhuaTemplateLapianDurationSec(card: LapianCard): number {
  const native = card.provenance?.nativeVideoDeepRead;
  const fromSource = Number(native?.sourceDurationSec);
  if (Number.isFinite(fromSource) && fromSource > 0) return fromSource;
  const spans = native?.segmentSpans || [];
  const fromSpans = spans.length ? Number(spans[spans.length - 1]!.endSec) : NaN;
  if (Number.isFinite(fromSpans) && fromSpans > 0) return fromSpans;
  const fromBeats = Math.max(0, ...(card.beatGrid || []).map(b => Math.max(Number(b.atSec) || 0, Number(b.endSec) || 0)));
  return fromBeats > 0 ? fromBeats : 1;
}

/** 时间码越界检查：返回越界镜头的下标（空 = 全部在 0..片长 内）。 */
export function findManhuaTemplateShotTimecodeIssues(rows: readonly ManhuaTemplateShotRow[], durationSec: number): number[] {
  return rows.flatMap(row => row.startSec < 0
    || row.startSec > durationSec + MANHUA_TEMPLATE_LAPIAN_TOLERANCE_SEC
    || (row.endSec != null && (row.endSec <= row.startSec || row.endSec > durationSec + MANHUA_TEMPLATE_LAPIAN_TOLERANCE_SEC))
    ? [row.index] : []);
}

// ─── 分段计划 ──────────────────────────────────────────

export type ManhuaTemplateLapianSegment = {
  index: number;
  startSec: number;
  endSec: number;
  /** 所属学习分片（0 起）；片段裁切按它找回 GCS 源分片，段从不跨分片。 */
  learnSpanIndex: number;
  learnSpanStartSec: number;
  learnSpanEndSec: number;
  /** beatGrid 下标，原序、连续。 */
  shotIndexes: number[];
};

function learnSpansOf(card: LapianCard): Array<{ startSec: number; endSec: number }> {
  const spans = (card.provenance?.nativeVideoDeepRead?.segmentSpans || [])
    .map(s => ({ startSec: Number(s.startSec), endSec: Number(s.endSec) }))
    .filter(s => Number.isFinite(s.startSec) && Number.isFinite(s.endSec) && s.endSec > s.startSec)
    .sort((a, b) => a.startSec - b.startSec);
  if (spans.length) return spans;
  return [{ startSec: 0, endSec: manhuaTemplateLapianDurationSec(card) }];
}

/**
 * 确定性分段：先按学习分片切，片内按镜头边界贪心累积，满 60 秒或满 40 镜收段；
 * 尾段不足 20 秒且合并后不超 40 镜并入上一段。每一镜按 atSec 归入唯一一段（落在所有分片之外的
 * 归最近的分片），保证条数进 = 出。段在同一分片内首尾相接、覆盖分片全长。
 */
export function planManhuaTemplateLapianSegments(card: LapianCard): ManhuaTemplateLapianSegment[] {
  const spans = learnSpansOf(card);
  const beats = card.beatGrid || [];
  const bySpan: number[][] = spans.map(() => []);
  beats.forEach((beat, index) => {
    const at = Number(beat.atSec) || 0;
    let host = spans.findIndex((s, i) => at >= s.startSec && (i === spans.length - 1 ? at <= s.endSec : at < s.endSec));
    if (host < 0) {
      // 落在所有分片之外（片头前 / 片尾后 / 分片缝隙）：归到起点不晚于它的最后一个分片，没有就归第一个。
      host = 0;
      spans.forEach((s, i) => { if (s.startSec <= at) host = i; });
    }
    bySpan[host]!.push(index);
  });
  const out: ManhuaTemplateLapianSegment[] = [];
  spans.forEach((span, spanIndex) => {
    const indexes = bySpan[spanIndex]!.slice().sort((a, b) => (Number(beats[a]!.atSec) || 0) - (Number(beats[b]!.atSec) || 0) || a - b);
    const groups: number[][] = [];
    let current: number[] = [];
    let currentStart = span.startSec;
    for (const index of indexes) {
      const at = Number(beats[index]!.atSec) || 0;
      if (current.length && (current.length >= MANHUA_TEMPLATE_LAPIAN_MAX_SHOTS || at - currentStart >= MANHUA_TEMPLATE_LAPIAN_TARGET_SEC)) {
        groups.push(current);
        current = [];
        currentStart = at;
      }
      current.push(index);
    }
    if (current.length || !groups.length) groups.push(current);
    // 尾段太短并入上一段
    if (groups.length >= 2) {
      const tail = groups[groups.length - 1]!;
      const tailStart = tail.length ? Number(beats[tail[0]!]!.atSec) || 0 : span.endSec;
      if (span.endSec - tailStart < MANHUA_TEMPLATE_LAPIAN_MIN_TAIL_SEC && groups[groups.length - 2]!.length + tail.length <= MANHUA_TEMPLATE_LAPIAN_MAX_SHOTS) {
        groups[groups.length - 2]!.push(...tail);
        groups.pop();
      }
    }
    groups.forEach((group, g) => {
      const startSec = g === 0 ? span.startSec : r1(Math.max(span.startSec, Number(beats[group[0]!]!.atSec) || 0));
      const nextFirst = groups[g + 1]?.[0];
      const endSec = nextFirst === undefined ? span.endSec : r1(Math.max(startSec, Number(beats[nextFirst]!.atSec) || 0));
      out.push({ index: out.length, startSec, endSec, learnSpanIndex: spanIndex, learnSpanStartSec: span.startSec, learnSpanEndSec: span.endSec, shotIndexes: group });
    });
  });
  return out;
}

// ─── 段证据包（喂文字模型；不含字幕原文） ───────────────

const BEAT_EVIDENCE_KEYS = [
  "hintZh", "unitTypeZh", "shotSizeZh", "angleZh", "compositionZh", "cameraMoveZh", "blockingZh", "bodyActionZh",
  "limbPropActionZh", "microExpressionZh", "gazeBreathZh", "relationshipReactionZh", "lightingZh", "transitionInZh",
] as const satisfies readonly (keyof ManhuaViralTemplateBeat)[];

function beatEvidence(beat: ManhuaViralTemplateBeat, offsetSec: number) {
  const row: Record<string, unknown> = {
    fromSec: r1((Number(beat.atSec) || 0) - offsetSec),
    toSec: Number.isFinite(Number(beat.endSec)) && Number(beat.endSec) > Number(beat.atSec) ? r1(Number(beat.endSec) - offsetSec) : null,
    visualZh: beat.visualZh,
  };
  for (const key of BEAT_EVIDENCE_KEYS) if (clean(beat[key])) row[key] = clean(beat[key]);
  return row;
}

export type ManhuaTemplateLapianSegmentEvidence = {
  segmentIndex: number;
  lengthSec: number;
  /** 段内相对秒，全部镜头，条数 = segment.shotIndexes.length。 */
  shots: Array<Record<string, unknown>>;
  /** 与本段重叠的音轨行（段内相对秒、裁到段内）及段内 cue。 */
  audio: Array<Record<string, unknown>>;
  /** 本段内的重点时刻说明（无截图地址）。 */
  keyMoments: Array<{ atSec: number; kindZh: string; noteZh: string }>;
  /** 段所在学习分片的节拍结构（卡上 conflictZh 已是分片级） */
  beatStructureZh: string[];
  episodeCraft: { reusableZh?: string; genPromptHintZh?: string };
};

export function buildManhuaTemplateLapianSegmentEvidence(card: LapianCard, segment: ManhuaTemplateLapianSegment): ManhuaTemplateLapianSegmentEvidence {
  const beats = card.beatGrid || [];
  const offset = segment.startSec;
  const lengthSec = r1(segment.endSec - segment.startSec);
  const within = (at: number) => at >= segment.startSec && at < segment.endSec + (segment.endSec >= segment.learnSpanEndSec ? MANHUA_TEMPLATE_LAPIAN_TOLERANCE_SEC : 0);
  const audio = (card.audioStory?.audioTrack || []).flatMap(track => {
    if (!(track.toSec > segment.startSec && track.fromSec < segment.endSec)) return [];
    return [{
      fromSec: r1(Math.max(0, track.fromSec - offset)),
      toSec: r1(Math.min(lengthSec, track.toSec - offset)),
      emotionArcZh: track.emotionArcZh, toneZh: track.toneZh, sfxZh: track.sfxZh, bgmZh: track.bgmZh,
      atmosphereZh: track.atmosphereZh, silenceZh: track.silenceZh,
      cues: (track.cues || []).filter(cue => within(cue.atSec)).map(cue => ({ atSec: r1(cue.atSec - offset), kind: cue.kind, detailZh: cue.detailZh })),
    }];
  });
  const keyMoments = (card.evidenceFrames || []).filter(f => within(f.atSec))
    .map(f => ({ atSec: r1(f.atSec - offset), kindZh: f.kindZh, noteZh: f.noteZh }));
  const beatStructureZh = Array.from(new Set(segment.shotIndexes.map(i => clean(beats[i]?.conflictZh)).filter(Boolean)));
  const episodeCraft: ManhuaTemplateLapianSegmentEvidence["episodeCraft"] = {};
  if (clean(card.reusableZh)) episodeCraft.reusableZh = clean(card.reusableZh);
  if (clean(card.genPromptHintZh)) episodeCraft.genPromptHintZh = clean(card.genPromptHintZh);
  return {
    segmentIndex: segment.index,
    lengthSec,
    shots: segment.shotIndexes.map(i => beatEvidence(beats[i]!, offset)),
    audio,
    keyMoments,
    beatStructureZh,
    episodeCraft,
  };
}

// ─── 视觉频次统计 + 基因汇总证据（全片全量） ─────────────

export type ManhuaTemplateLapianCount = { valueZh: string; count: number };
export type ManhuaTemplateLapianVisualStats = {
  shotCount: number;
  framing: ManhuaTemplateLapianCount[];
  angle: ManhuaTemplateLapianCount[];
  cameraMove: ManhuaTemplateLapianCount[];
  transitionIn: ManhuaTemplateLapianCount[];
  unitType: ManhuaTemplateLapianCount[];
  /** 该字段为空的镜头数（brief 镜 / 旧抽帧卡），与上面计数合计 = shotCount。 */
  missing: { framing: number; angle: number; cameraMove: number; transitionIn: number; unitType: number };
};

function countBy(beats: readonly ManhuaViralTemplateBeat[], key: keyof ManhuaViralTemplateBeat): { rows: ManhuaTemplateLapianCount[]; missing: number } {
  const map = new Map<string, number>();
  let missing = 0;
  for (const beat of beats) {
    const value = clean(beat[key]);
    if (!value) { missing += 1; continue; }
    map.set(value, (map.get(value) || 0) + 1);
  }
  // 全部取值都列出，不取 TopN。
  return { rows: Array.from(map, ([valueZh, count]) => ({ valueZh, count })).sort((a, b) => b.count - a.count || a.valueZh.localeCompare(b.valueZh)), missing };
}

export function summarizeManhuaTemplateVisualStats(card: Pick<ManhuaViralTemplateCard, "beatGrid">): ManhuaTemplateLapianVisualStats {
  const beats = card.beatGrid || [];
  const framing = countBy(beats, "shotSizeZh");
  const angle = countBy(beats, "angleZh");
  const cameraMove = countBy(beats, "cameraMoveZh");
  const transitionIn = countBy(beats, "transitionInZh");
  const unitType = countBy(beats, "unitTypeZh");
  return {
    shotCount: beats.length,
    framing: framing.rows, angle: angle.rows, cameraMove: cameraMove.rows, transitionIn: transitionIn.rows, unitType: unitType.rows,
    missing: { framing: framing.missing, angle: angle.missing, cameraMove: cameraMove.missing, transitionIn: transitionIn.missing, unitType: unitType.missing },
  };
}

/** 视觉基因汇总的模型输入：全片每一镜的视觉字段（绝对秒）+ 全量频次 + 卡级视听判词。 */
export function buildManhuaTemplateLapianGenesEvidence(card: LapianCard) {
  const beats = card.beatGrid || [];
  return {
    durationSec: manhuaTemplateLapianDurationSec(card),
    stats: summarizeManhuaTemplateVisualStats(card),
    shots: beats.map(beat => {
      const row: Record<string, unknown> = { atSec: r1(Number(beat.atSec) || 0) };
      for (const key of ["hintZh", "shotSizeZh", "angleZh", "compositionZh", "cameraMoveZh", "lightingZh", "transitionInZh"] as const)
        if (clean(beat[key])) row[key] = clean(beat[key]);
      if (Object.keys(row).length === 1) row.visualZh = beat.visualZh;
      return row;
    }),
    audiovisualTagsZh: card.classification?.audiovisualTagsZh || [],
    reusableZh: clean(card.reusableZh) || undefined,
    genPromptHintZh: clean(card.genPromptHintZh) || undefined,
    mixNotesZh: clean(card.audioStory?.mixNotesZh) || undefined,
  };
}

// ─── 模型输出契约（复用拉片子 schema） ─────────────────

const overviewShape = videoBreakdownSchema.shape.overview.shape;
export const manhuaTemplateLapianGenesOutputSchema = z.object({
  visualGenes: videoBreakdownVisualGenesSchema,
  recurringElements: overviewShape.recurringElements,
  mustKeep: overviewShape.mustKeep,
}).strict();
export type ManhuaTemplateLapianGenes = z.infer<typeof manhuaTemplateLapianGenesOutputSchema>;

export const manhuaTemplateLapianSegmentOutputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  recreatePrompt: videoBreakdownRecreatePromptSchema,
}).strict();
export type ManhuaTemplateLapianSegmentOutput = z.infer<typeof manhuaTemplateLapianSegmentOutputSchema>;

/**
 * 段输出校验：先过拉片 schema，再按拉片同一口径查时间窗（段内相对秒、toSec > fromSec、不超段长），
 * 另要求时间窗按序且从段首附近开始。返回中文问题清单，空数组即通过。
 */
export function validateManhuaTemplateLapianSegmentOutput(value: unknown, lengthSec: number): { ok: true; value: ManhuaTemplateLapianSegmentOutput } | { ok: false; issues: string[] } {
  const parsed = manhuaTemplateLapianSegmentOutputSchema.safeParse(value);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.slice(0, 20).map(i => `${i.path.join(".") || "(根)"}：${i.message}`) };
  const issues: string[] = [];
  const windows = parsed.data.recreatePrompt.timeline;
  windows.forEach((w, i) => {
    if (!(w.toSec > w.fromSec)) issues.push(`第${i + 1}个时间窗结束不晚于开始`);
    if (w.toSec > lengthSec + MANHUA_TEMPLATE_LAPIAN_TOLERANCE_SEC) issues.push(`第${i + 1}个时间窗超出段长 ${lengthSec} 秒`);
    if (i > 0 && w.fromSec < windows[i - 1]!.fromSec) issues.push(`第${i + 1}个时间窗未按时间顺序`);
  });
  if (windows[0] && windows[0].fromSec > MANHUA_TEMPLATE_LAPIAN_TOLERANCE_SEC + 1) issues.push("首个时间窗没有从段首开始");
  return issues.length ? { ok: false, issues: Array.from(new Set(issues)) } : { ok: true, value: parsed.data };
}

export function validateManhuaTemplateLapianGenesOutput(value: unknown): { ok: true; value: ManhuaTemplateLapianGenes } | { ok: false; issues: string[] } {
  const parsed = manhuaTemplateLapianGenesOutputSchema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data }
    : { ok: false, issues: parsed.error.issues.slice(0, 20).map(i => `${i.path.join(".") || "(根)"}：${i.message}`) };
}

/** 秒锁文本：直接用拉片的格式函数（它只读 recreatePrompt）。 */
export function formatManhuaTemplateLapianRecreatePrompt(prompt: ManhuaTemplateLapianSegmentOutput["recreatePrompt"]): string {
  return formatVideoBreakdownRecreatePrompt({ recreatePrompt: prompt } as Pick<VideoBreakdownSegment, "recreatePrompt"> as VideoBreakdownSegment);
}

export const MANHUA_TEMPLATE_LAPIAN_GENE_LABELS = [
  ["mediumAndArtStyle", "媒介与美术风格"], ["color", "色彩"], ["lighting", "光线"],
  ["materialTexture", "材质与质感"], ["composition", "构图"], ["camera", "摄影机"],
] as const;

export function formatManhuaTemplateLapianGenes(genes: ManhuaTemplateLapianGenes): string {
  return [
    ...MANHUA_TEMPLATE_LAPIAN_GENE_LABELS.map(([key, label]) => `【${label}】${genes.visualGenes[key]}`),
    `【反复出现的元素】${genes.recurringElements.join("；")}`,
    `【复刻时要保留的要点】`,
    ...genes.mustKeep.map((item, i) => `${i + 1}. ${item}`),
  ].join("\n");
}

export function formatManhuaTemplateShotTableTsv(rows: readonly ManhuaTemplateShotRow[]): string {
  const t = (n: number) => `${Math.floor(n / 60).toString().padStart(2, "0")}:${(n % 60).toFixed(1).padStart(4, "0")}`;
  return ["时间\t画面景别\t摄影机\t调度·构图与焦点",
    ...rows.map(r => `${t(r.startSec)}${r.endSec != null ? `–${t(r.endSec)}` : ""}\t${r.framing}\t${r.camera}\t${r.blockingAndFocus}`.replace(/\n/g, " "))].join("\n");
}
