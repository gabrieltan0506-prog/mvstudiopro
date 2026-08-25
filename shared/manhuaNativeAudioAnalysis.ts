import { z } from "zod";

export const MANHUA_NATIVE_AUDIO_MODEL = "gemini-3.6-flash" as const;
export const MANHUA_NATIVE_AUDIO_RESOLVER_MODEL = "qwen3.8-max" as const;
export const MANHUA_NATIVE_AUDIO_RESOLVER_ROUTE = "singapore_token_plan_video" as const;
export const MANHUA_NATIVE_AUDIO_MODEL_LABEL = "Gemini 3.6 Flash 双路 + Qwen 3.8 Max" as const;
export const MANHUA_NATIVE_AUDIO_ALIGNMENT = "ffmpeg_sample_clock_dual_v2" as const;
export const MANHUA_NATIVE_AUDIO_SOURCE_VARIANTS = ["mono_16k", "stereo_32k"] as const;
export type ManhuaNativeAudioSourceVariant =
  (typeof MANHUA_NATIVE_AUDIO_SOURCE_VARIANTS)[number];

/** 以时间分段；32kHz 立体声 64kbps 的 45 分钟约 21.6MB，低于 30MB 上限。 */
export const MANHUA_NATIVE_AUDIO_CHUNK_MAX_SEC = 45 * 60;
export const MANHUA_NATIVE_AUDIO_MAX_TRACKS = 128;
export const MANHUA_NATIVE_AUDIO_MAX_CUES = 128;

export type ManhuaNativeAudioCueKind =
  | "sfx" | "bgm_in" | "bgm_change" | "bgm_out" | "silence_in" | "silence_out";

export type ManhuaNativeAudioCue = {
  atSec: number;
  kind: ManhuaNativeAudioCueKind;
  detailZh: string;
};

export type ManhuaNativeAudioTrack = {
  fromSec: number;
  toSec: number;
  emotionArcZh: string;
  toneZh: string;
  sfxZh: string;
  bgmZh: string;
  atmosphereZh: string;
  silenceZh: string;
  cues: ManhuaNativeAudioCue[];
};

export type ManhuaNativeAudioChunkAnalysis = {
  audioTrack: ManhuaNativeAudioTrack[];
  audioBeatStructureZh: string;
  mixNotesZh: string;
  reusableAudioZh: string;
  genAudioHintZh: string;
};

export type ManhuaNativeAudioUsage = {
  inputTokens: number;
  audioInputTokens: number;
  outputTokens: number;
  costCny: number;
  receiptComplete: boolean;
  geminiInputTokens: number;
  geminiAudioInputTokens: number;
  geminiOutputTokens: number;
  geminiCostCny: number;
  geminiCalls: number;
};

export type ManhuaNativeAudioAnalysis = {
  model: typeof MANHUA_NATIVE_AUDIO_MODEL;
  resolverModel: typeof MANHUA_NATIVE_AUDIO_RESOLVER_MODEL;
  resolverRoute: typeof MANHUA_NATIVE_AUDIO_RESOLVER_ROUTE;
  sourceVariants: typeof MANHUA_NATIVE_AUDIO_SOURCE_VARIANTS;
  hasAudio: boolean;
  alignmentMethod: typeof MANHUA_NATIVE_AUDIO_ALIGNMENT;
  durationSec: number;
  chunkCount: number;
  audioTrack: ManhuaNativeAudioTrack[];
  audioBeatStructureZh?: string;
  mixNotesZh?: string;
  reusableAudioZh?: string;
  genAudioHintZh?: string;
  usage: ManhuaNativeAudioUsage;
};

/** Gemini 双路中间证据；仅驻留 worker 内存，交给新加坡视频 Qwen 自动裁决。 */
export type ManhuaNativeAudioEvidenceChunk = {
  chunk: ManhuaNativeAudioChunk;
  mono16k: ManhuaNativeAudioChunkAnalysis;
  stereo32k: ManhuaNativeAudioChunkAnalysis;
};

export type ManhuaNativeAudioEvidence = {
  hasAudio: boolean;
  durationSec: number;
  chunks: ManhuaNativeAudioEvidenceChunk[];
  usage: ManhuaNativeAudioUsage;
};

export type ManhuaNativeAudioChunk = { index: number; startSec: number; endSec: number };

export function splitManhuaNativeAudioChunks(durationSec: number): ManhuaNativeAudioChunk[] {
  const total = Math.max(1, Math.floor(Number(durationSec) || 0));
  const out: ManhuaNativeAudioChunk[] = [];
  for (let startSec = 0, index = 0; startSec < total; index += 1) {
    const endSec = Math.min(total, startSec + MANHUA_NATIVE_AUDIO_CHUNK_MAX_SEC);
    out.push({ index, startSec, endSec });
    startSec = endSec;
  }
  return out;
}

const audioCueSchema = z.object({
  atSec: z.number().finite().int().min(0),
  kind: z.enum(["sfx", "bgm_in", "bgm_change", "bgm_out", "silence_in", "silence_out"]),
  detailZh: z.string().trim().min(1),
}).strict();

const audioTrackSchema = z.object({
  fromSec: z.number().finite().int().min(0),
  toSec: z.number().finite().int().min(0),
  emotionArcZh: z.string().trim().min(1),
  toneZh: z.string().trim().default(""),
  sfxZh: z.string().trim().default(""),
  bgmZh: z.string().trim().default(""),
  atmosphereZh: z.string().trim().default(""),
  silenceZh: z.string().trim().default(""),
  cues: z.array(audioCueSchema).max(MANHUA_NATIVE_AUDIO_MAX_CUES).default([]),
}).strict();

export const manhuaNativeAudioChunkAnalysisSchema = z.object({
  audioTrack: z.array(audioTrackSchema).min(1).max(MANHUA_NATIVE_AUDIO_MAX_TRACKS),
  audioBeatStructureZh: z.string().trim().min(1),
  mixNotesZh: z.string().trim().default(""),
  reusableAudioZh: z.string().trim().min(1),
  genAudioHintZh: z.string().trim().min(1),
}).strict();

const cut = (value: unknown, max: number): string | undefined =>
  String(value || "").trim().slice(0, max) || undefined;
const CLOCK_RE = /(?<!\d)(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)(?!\d)/;
/**
 * 剥离用的 /g 克隆：在 CLOCK_RE 之外多吞可选的前导连接词（在/于/至/到）、
 * 紧跟的区间连字符（01:23-01:40 的“-”）和后缀残渣（处/左右/时/附近/秒）。
 */
const CLOCK_STRIP_RE = new RegExp(
  `(?:在|于|至|到)?${CLOCK_RE.source}(?:\\s*[-–—~～]\\s*)?(?:处|左右|时|附近|秒)?`,
  "g",
);

function assertNoClockText(value: unknown): void {
  if (CLOCK_RE.test(String(value || ""))) {
    throw new Error("音频描述含第二套文本秒位，拒绝入库");
  }
}

/**
 * 剥离文本里的钟表式秒位（0826 用户拍板）：数字字段是唯一时间真源，
 * 散文里的 MM:SS 定义上就是冗余或幻觉——直接删除，不再整轮拒收重买。
 * 顺带吞掉「在…处/左右/时」这类挂在钟表文本上的连接残渣。
 */
export function stripClockTextZh(value: string): string {
  const raw = String(value ?? "");
  const stripped = raw.replace(CLOCK_STRIP_RE, "");
  if (stripped === raw) return raw;
  return stripped
    .replace(/[ \t]{2,}/g, " ")
    .replace(/、{2,}/g, "、")
    .replace(/^[、，,；;\s]+/, "")
    .trim();
}

/**
 * 门禁类失败＝模型输出没过 normalize/校验（结构、时间轴、剥离后空文）。
 * 网络、超时、上游 HTTP、用户中止都不算——只有门禁类才值得带原因重试一次。
 */
export function isManhuaNativeAudioGateFailureZh(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "ZodError") return true;
  return /音频分析|音频事件|音频描述/.test(error.message);
}

function assertTrackCoverage(
  tracks: readonly Pick<ManhuaNativeAudioTrack, "fromSec" | "toSec">[],
  startSec: number,
  endSec: number,
): void {
  if (!tracks.length) throw new Error("音频分析没有有效时间段");
  const ordered = [...tracks].sort((a, b) => a.fromSec - b.fromSec || a.toSec - b.toSec);
  if (Math.abs(ordered[0]!.fromSec - startSec) > 0.5) throw new Error("音频分析未从片段开头起步");
  let cursor = startSec;
  for (const track of ordered) {
    if (track.fromSec > cursor + 0.5) throw new Error("音频分析时间轴存在未解释空洞");
    if (track.fromSec < cursor - 0.5) throw new Error("音频分析时间轴存在重叠");
    cursor = track.toSec;
  }
  if (Math.abs(cursor - endSec) > 0.5) throw new Error("音频分析未覆盖片段结尾");
}

/** 校验段内结果并换算为全片绝对秒。 */
export function normalizeManhuaNativeAudioChunkAnalysis(input: {
  raw: unknown;
  chunk: ManhuaNativeAudioChunk;
}): ManhuaNativeAudioChunkAnalysis {
  const parsed = manhuaNativeAudioChunkAnalysisSchema.parse(input.raw);
  const lenSec = input.chunk.endSec - input.chunk.startSec;
  const localTracks = [...parsed.audioTrack]
    .sort((a, b) => a.fromSec - b.fromSec || a.toSec - b.toSec);
  assertTrackCoverage(localTracks, 0, lenSec);
  /**
   * 写入路（0826 用户拍板）：文本秒位不再 assert 拒收，改为先剥离再入库。
   * 数字时间轴校验（覆盖、cue 边界）保持硬门禁不动。
   */
  let strippedCount = 0;
  const sanitize = (value: string): string => {
    const next = stripClockTextZh(value);
    if (next !== value) strippedCount += 1;
    return next;
  };
  const sanitizeRequired = (value: string): string => {
    const next = sanitize(value);
    if (!next.trim()) throw new Error("音频描述剥离文本秒位后正文为空，拒绝入库");
    return next;
  };
  const audioTrack = localTracks.map((track): ManhuaNativeAudioTrack => {
    if (track.cues.some((cue) => cue.atSec < track.fromSec || cue.atSec > track.toSec)) {
      throw new Error("音频事件秒位不属于声明区间");
    }
    return {
      fromSec: input.chunk.startSec + track.fromSec,
      toSec: input.chunk.startSec + track.toSec,
      emotionArcZh: cut(sanitizeRequired(track.emotionArcZh), 160)!,
      toneZh: cut(sanitize(track.toneZh), 120) || "",
      sfxZh: cut(sanitize(track.sfxZh), 160) || "",
      bgmZh: cut(sanitize(track.bgmZh), 160) || "",
      atmosphereZh: cut(sanitize(track.atmosphereZh), 100) || "",
      silenceZh: cut(sanitize(track.silenceZh), 120) || "",
      cues: track.cues.map((cue) => ({
        atSec: input.chunk.startSec + cue.atSec,
        kind: cue.kind,
        // cues[].detailZh 此前从未被扫描（已知缺口），一并纳入剥离。
        detailZh: cut(sanitizeRequired(cue.detailZh), 100)!,
      })),
    };
  });
  const audioBeatStructureZh = sanitizeRequired(parsed.audioBeatStructureZh);
  const mixNotesZh = sanitize(parsed.mixNotesZh);
  const reusableAudioZh = sanitizeRequired(parsed.reusableAudioZh);
  const genAudioHintZh = sanitizeRequired(parsed.genAudioHintZh);
  if (strippedCount > 0) {
    console.warn(
      `[nativeAudioAnalysis] 已剥离文本秒位 ${strippedCount} 处（数字时间轴为唯一真源）`,
    );
  }
  return {
    audioTrack,
    audioBeatStructureZh: cut(audioBeatStructureZh, 500)!,
    mixNotesZh: cut(mixNotesZh, 500) || "",
    reusableAudioZh: cut(reusableAudioZh, 500)!,
    genAudioHintZh: cut(genAudioHintZh, 500)!,
  };
}

function mergeContinuousAudioTracks(
  rows: readonly ManhuaNativeAudioTrack[],
  max: number,
): ManhuaNativeAudioTrack[] {
  if (rows.length <= max) return [...rows];
  const groups: ManhuaNativeAudioTrack[][] = Array.from({ length: max }, () => []);
  rows.forEach((row, index) => {
    groups[Math.min(max - 1, Math.floor((index * max) / rows.length))]!.push(row);
  });
  const join = (group: readonly ManhuaNativeAudioTrack[], key: keyof Pick<
    ManhuaNativeAudioTrack,
    "emotionArcZh" | "toneZh" | "sfxZh" | "bgmZh" | "atmosphereZh" | "silenceZh"
  >, maxChars: number) => Array.from(new Set(group.map((row) => row[key]).filter(Boolean)))
    .join("；")
    .slice(0, maxChars);
  return groups.filter((group) => group.length).map((group) => ({
    fromSec: group[0]!.fromSec,
    toSec: group[group.length - 1]!.toSec,
    emotionArcZh: join(group, "emotionArcZh", 160),
    toneZh: join(group, "toneZh", 120),
    sfxZh: join(group, "sfxZh", 160),
    bgmZh: join(group, "bgmZh", 160),
    atmosphereZh: join(group, "atmosphereZh", 100),
    silenceZh: join(group, "silenceZh", 120),
    cues: group.flatMap((row) => row.cues),
  }));
}

export function mergeManhuaNativeAudioChunks(input: {
  durationSec: number;
  chunks: readonly ManhuaNativeAudioChunkAnalysis[];
  usage: ManhuaNativeAudioUsage;
}): ManhuaNativeAudioAnalysis {
  if (!input.chunks.length) throw new Error("音频分析分段为空");
  const durationSec = Math.max(1, Math.floor(Number(input.durationSec) || 0));
  const allTracks = input.chunks.flatMap((row) => row.audioTrack)
    .sort((a, b) => a.fromSec - b.fromSec || a.toSec - b.toSec);
  assertTrackCoverage(allTracks, 0, durationSec);
  if (allTracks.reduce((sum, track) => sum + track.cues.length, 0) > MANHUA_NATIVE_AUDIO_MAX_CUES) {
    throw new Error(`音频事件超过 ${MANHUA_NATIVE_AUDIO_MAX_CUES} 条承载上限`);
  }
  const join = (pick: (row: ManhuaNativeAudioChunkAnalysis) => string, max: number) =>
    cut(input.chunks.map(pick).filter(Boolean).join("；"), max);
  return {
    model: MANHUA_NATIVE_AUDIO_MODEL,
    resolverModel: MANHUA_NATIVE_AUDIO_RESOLVER_MODEL,
    resolverRoute: MANHUA_NATIVE_AUDIO_RESOLVER_ROUTE,
    sourceVariants: MANHUA_NATIVE_AUDIO_SOURCE_VARIANTS,
    hasAudio: true,
    alignmentMethod: MANHUA_NATIVE_AUDIO_ALIGNMENT,
    durationSec,
    chunkCount: input.chunks.length,
    audioTrack: mergeContinuousAudioTracks(allTracks, MANHUA_NATIVE_AUDIO_MAX_TRACKS),
    audioBeatStructureZh: join((row) => row.audioBeatStructureZh, 1_000),
    mixNotesZh: join((row) => row.mixNotesZh, 1_000),
    reusableAudioZh: join((row) => row.reusableAudioZh, 1_000),
    genAudioHintZh: join((row) => row.genAudioHintZh, 1_000),
    usage: input.usage,
  };
}

export function noAudioManhuaNativeAnalysis(durationSec: number): ManhuaNativeAudioAnalysis {
  return {
    model: MANHUA_NATIVE_AUDIO_MODEL,
    resolverModel: MANHUA_NATIVE_AUDIO_RESOLVER_MODEL,
    resolverRoute: MANHUA_NATIVE_AUDIO_RESOLVER_ROUTE,
    sourceVariants: MANHUA_NATIVE_AUDIO_SOURCE_VARIANTS,
    hasAudio: false,
    alignmentMethod: MANHUA_NATIVE_AUDIO_ALIGNMENT,
    durationSec: Math.max(1, Math.floor(Number(durationSec) || 0)),
    chunkCount: 0,
    audioTrack: [],
    usage: {
      inputTokens: 0, audioInputTokens: 0, outputTokens: 0, costCny: 0,
      receiptComplete: true, geminiInputTokens: 0, geminiAudioInputTokens: 0,
      geminiOutputTokens: 0, geminiCostCny: 0, geminiCalls: 0,
    },
  };
}

/** GCS 卡片读取门：双路、合并器、时间轴和用量证据缺一不可。 */
export function parseManhuaNativeAudioAnalysis(raw: unknown): ManhuaNativeAudioAnalysis | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Partial<ManhuaNativeAudioAnalysis>;
  const durationSec = Math.max(1, Math.floor(Number(o.durationSec) || 0));
  if (
    o.model !== MANHUA_NATIVE_AUDIO_MODEL
    || o.resolverModel !== MANHUA_NATIVE_AUDIO_RESOLVER_MODEL
    || o.resolverRoute !== MANHUA_NATIVE_AUDIO_RESOLVER_ROUTE
    || o.alignmentMethod !== MANHUA_NATIVE_AUDIO_ALIGNMENT
    || typeof o.hasAudio !== "boolean"
    || JSON.stringify(o.sourceVariants) !== JSON.stringify(MANHUA_NATIVE_AUDIO_SOURCE_VARIANTS)
  ) return undefined;
  const audioTrack = (Array.isArray(o.audioTrack) ? o.audioTrack : [])
    .flatMap((row): ManhuaNativeAudioTrack[] => {
      const parsed = audioTrackSchema.safeParse(row);
      if (!parsed.success || parsed.data.toSec <= parsed.data.fromSec) return [];
      return [parsed.data];
    })
    .sort((a, b) => a.fromSec - b.fromSec || a.toSec - b.toSec);
  const u = (o.usage || {}) as Partial<ManhuaNativeAudioUsage>;
  const usage: ManhuaNativeAudioUsage = {
    inputTokens: Math.max(0, Math.floor(Number(u.inputTokens) || 0)),
    audioInputTokens: Math.max(0, Math.floor(Number(u.audioInputTokens) || 0)),
    outputTokens: Math.max(0, Math.floor(Number(u.outputTokens) || 0)),
    costCny: Math.max(0, Number(u.costCny) || 0),
    receiptComplete: u.receiptComplete === true,
    geminiInputTokens: Math.max(0, Math.floor(Number(u.geminiInputTokens) || 0)),
    geminiAudioInputTokens: Math.max(0, Math.floor(Number(u.geminiAudioInputTokens) || 0)),
    geminiOutputTokens: Math.max(0, Math.floor(Number(u.geminiOutputTokens) || 0)),
    geminiCostCny: Math.max(0, Number(u.geminiCostCny) || 0),
    geminiCalls: Math.max(0, Math.floor(Number(u.geminiCalls) || 0)),
  };
  const chunkCount = Math.max(0, Math.floor(Number(o.chunkCount) || 0));
  if (o.hasAudio) {
    try {
      assertTrackCoverage(audioTrack, 0, durationSec);
      for (const track of audioTrack) {
        if (track.cues.some((cue) => cue.atSec < track.fromSec || cue.atSec > track.toSec)) return undefined;
        for (const value of [track.emotionArcZh, track.toneZh, track.sfxZh, track.bgmZh, track.atmosphereZh, track.silenceZh]) {
          assertNoClockText(value);
        }
      }
      for (const value of [o.audioBeatStructureZh, o.mixNotesZh, o.reusableAudioZh, o.genAudioHintZh]) assertNoClockText(value);
    } catch {
      return undefined;
    }
    // 双路完整性下限：每段至少 2 次成功调用。0826 起门禁重试会诚实多计 1–2 次
    // 已付费调用，等号会把重试过的卡整张拒读，故只卡下限。
    if (
      chunkCount < 1 || usage.geminiCalls < chunkCount * 2
      || usage.audioInputTokens <= 0 || !usage.receiptComplete
      || !cut(o.audioBeatStructureZh, 1_000) || !cut(o.reusableAudioZh, 1_000)
      || !cut(o.genAudioHintZh, 1_000)
    ) return undefined;
  } else if (chunkCount !== 0 || audioTrack.length !== 0 || usage.geminiCalls) {
    return undefined;
  }
  return {
    model: MANHUA_NATIVE_AUDIO_MODEL,
    resolverModel: MANHUA_NATIVE_AUDIO_RESOLVER_MODEL,
    resolverRoute: MANHUA_NATIVE_AUDIO_RESOLVER_ROUTE,
    sourceVariants: MANHUA_NATIVE_AUDIO_SOURCE_VARIANTS,
    hasAudio: o.hasAudio,
    alignmentMethod: MANHUA_NATIVE_AUDIO_ALIGNMENT,
    durationSec,
    chunkCount,
    audioTrack,
    audioBeatStructureZh: cut(o.audioBeatStructureZh, 1_000),
    mixNotesZh: cut(o.mixNotesZh, 1_000),
    reusableAudioZh: cut(o.reusableAudioZh, 1_000),
    genAudioHintZh: cut(o.genAudioHintZh, 1_000),
    usage,
  };
}
