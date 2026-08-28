import { z } from "zod";

export const MANHUA_NATIVE_AUDIO_MODEL = "gemini-3.6-flash" as const;
export const MANHUA_NATIVE_AUDIO_RESOLVER_MODEL = "qwen3.8-max" as const;
export const MANHUA_NATIVE_AUDIO_RESOLVER_ROUTE = "singapore_token_plan_video" as const;
export const MANHUA_NATIVE_AUDIO_MODEL_LABEL = "Gemini 3.6 Flash 双路 + Qwen 3.8 Max" as const;
export const MANHUA_NATIVE_AUDIO_ALIGNMENT = "ffmpeg_sample_clock_dual_v2" as const;
export const MANHUA_NATIVE_AUDIO_SOURCE_VARIANTS = ["mono_16k", "stereo_32k"] as const;
export type ManhuaNativeAudioSourceVariant =
  (typeof MANHUA_NATIVE_AUDIO_SOURCE_VARIANTS)[number];

/**
 * 0826 换代：视觉精读改 Gemini 3.1 Pro 直读视频后，音轨由同一次视觉调用
 * **亲耳所听**产出（不再有 Gemini 3.6 Flash 双声道取证 + Qwen 仲裁两步）。
 * 旧双路常量必须保留 —— 已入库卡的读取门还要按旧口径校验旧一代卡。
 */
export const MANHUA_NATIVE_AUDIO_DIRECT_MODEL = "gemini-3.1-pro-preview" as const;
export const MANHUA_NATIVE_AUDIO_DIRECT_ROUTES = [
  "vertex_gcs_video",
  "evolink_gemini_video",
] as const;
export type ManhuaNativeAudioDirectRoute =
  (typeof MANHUA_NATIVE_AUDIO_DIRECT_ROUTES)[number];
export const MANHUA_NATIVE_AUDIO_DIRECT_ALIGNMENT = "gemini_native_video_direct_v1" as const;
export const MANHUA_NATIVE_AUDIO_DIRECT_SOURCE_VARIANTS = ["native_video"] as const;

/** 以时间分段；32kHz 立体声 64kbps 的 45 分钟约 21.6MB，低于 30MB 上限。 */
export const MANHUA_NATIVE_AUDIO_CHUNK_MAX_SEC = 45 * 60;

/** 0827 实弹定稿：生产 Schema、解析门与探针必须共用同一份封闭词表。 */
export const MANHUA_NATIVE_AUDIO_CUE_KINDS = [
  "source_change",
  "voice_change",
  "sfx",
  "bgm_in",
  "bgm_change",
  "bgm_out",
  "atmosphere_change",
  "dynamics_change",
  "mix_change",
  "silence_in",
  "silence_out",
] as const;
export type ManhuaNativeAudioCueKind =
  (typeof MANHUA_NATIVE_AUDIO_CUE_KINDS)[number];

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
  model: typeof MANHUA_NATIVE_AUDIO_MODEL | typeof MANHUA_NATIVE_AUDIO_DIRECT_MODEL;
  resolverModel:
    | typeof MANHUA_NATIVE_AUDIO_RESOLVER_MODEL
    | typeof MANHUA_NATIVE_AUDIO_DIRECT_MODEL;
  resolverRoute: typeof MANHUA_NATIVE_AUDIO_RESOLVER_ROUTE | ManhuaNativeAudioDirectRoute;
  sourceVariants:
    | typeof MANHUA_NATIVE_AUDIO_SOURCE_VARIANTS
    | typeof MANHUA_NATIVE_AUDIO_DIRECT_SOURCE_VARIANTS;
  hasAudio: boolean;
  alignmentMethod:
    | typeof MANHUA_NATIVE_AUDIO_ALIGNMENT
    | typeof MANHUA_NATIVE_AUDIO_DIRECT_ALIGNMENT;
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
  kind: z.enum(MANHUA_NATIVE_AUDIO_CUE_KINDS),
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
  cues: z.array(audioCueSchema).default([]),
}).strict();

export const manhuaNativeAudioChunkAnalysisSchema = z.object({
  audioTrack: z.array(audioTrackSchema).min(1),
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

/** assertNoClockText 同口径的布尔探测：供视觉描述文本门禁复用（MM:SS 钟表式）。 */
export function hasClockTextZh(value: unknown): boolean {
  return CLOCK_RE.test(String(value || ""));
}

/**
 * 剥离文本里的钟表式秒位（0826 用户拍板）：数字字段是唯一时间真源，
 * 散文里的 MM:SS 定义上就是冗余或幻觉——直接删除，不再整轮拒收重买。
 * 顺带吞掉「在…处/左右/时」这类挂在钟表文本上的连接残渣。
 */
export function stripClockTextZh(value: string): string {
  const raw = String(value ?? "");
  let out = raw;
  // 审查#3：单轮剥离可能把相邻数字拼出新的钟表文本（如 "2在1:05处:15"→"2:15"），
  // 多轮剥到干净为止；四轮仍残留视为门禁失败（喂给带拒因重试），
  // 绝不让残留秒位写进卡片后在读门永久卡死一张已付费卡。
  for (let pass = 0; pass < 4; pass += 1) {
    const next = out.replace(CLOCK_STRIP_RE, "");
    if (next === out) break;
    out = next;
  }
  if (CLOCK_RE.test(out)) {
    throw new Error("音频描述含第二套文本秒位，剥离后仍残留，拒绝入库");
  }
  if (out === raw) return raw;
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/、{2,}/g, "、")
    .replace(/，{2,}/g, "，")
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

function mergeManhuaNativeAudioChunksCore(input: {
  durationSec: number;
  chunks: readonly ManhuaNativeAudioChunkAnalysis[];
  usage: ManhuaNativeAudioUsage;
}): Omit<
  ManhuaNativeAudioAnalysis,
  "model" | "resolverModel" | "resolverRoute" | "sourceVariants" | "alignmentMethod"
> {
  if (!input.chunks.length) throw new Error("音频分析分段为空");
  const durationSec = Math.max(1, Math.floor(Number(input.durationSec) || 0));
  const allTracks = input.chunks.flatMap((row) => row.audioTrack)
    .sort((a, b) => a.fromSec - b.fromSec || a.toSec - b.toSec);
  assertTrackCoverage(allTracks, 0, durationSec);
  const join = (pick: (row: ManhuaNativeAudioChunkAnalysis) => string, max: number) =>
    cut(input.chunks.map(pick).filter(Boolean).join("；"), max);
  return {
    hasAudio: true,
    durationSec,
    chunkCount: input.chunks.length,
    // 原始音轨证据必须逐条保留；容量不足由调用方显式失败或切换 fallback，
    // 不允许在已付费结果上合并、抽样或截断。
    audioTrack: allTracks,
    audioBeatStructureZh: join((row) => row.audioBeatStructureZh, 1_000),
    mixNotesZh: join((row) => row.mixNotesZh, 1_000),
    reusableAudioZh: join((row) => row.reusableAudioZh, 1_000),
    genAudioHintZh: join((row) => row.genAudioHintZh, 1_000),
    usage: input.usage,
  };
}

export function mergeManhuaNativeAudioChunks(input: {
  durationSec: number;
  chunks: readonly ManhuaNativeAudioChunkAnalysis[];
  usage: ManhuaNativeAudioUsage;
}): ManhuaNativeAudioAnalysis {
  return {
    ...mergeManhuaNativeAudioChunksCore(input),
    model: MANHUA_NATIVE_AUDIO_MODEL,
    resolverModel: MANHUA_NATIVE_AUDIO_RESOLVER_MODEL,
    resolverRoute: MANHUA_NATIVE_AUDIO_RESOLVER_ROUTE,
    sourceVariants: MANHUA_NATIVE_AUDIO_SOURCE_VARIANTS,
    alignmentMethod: MANHUA_NATIVE_AUDIO_ALIGNMENT,
  };
}

/**
 * 新一代（Gemini 直读）集卡音轨：视觉调用亲耳所听、按段产出、代码侧换算绝对秒。
 * usage 里的计费为 0 —— 音轨 token 已计入视觉调用回执，此处再计一遍就是双计。
 */
export function mergeManhuaNativeDirectAudioChunks(input: {
  durationSec: number;
  chunks: readonly ManhuaNativeAudioChunkAnalysis[];
  usage: ManhuaNativeAudioUsage;
  route: ManhuaNativeAudioDirectRoute;
}): ManhuaNativeAudioAnalysis {
  if (!MANHUA_NATIVE_AUDIO_DIRECT_ROUTES.includes(input.route)) {
    throw new Error("原生直读音轨 route 无效");
  }
  return {
    ...mergeManhuaNativeAudioChunksCore(input),
    model: MANHUA_NATIVE_AUDIO_DIRECT_MODEL,
    resolverModel: MANHUA_NATIVE_AUDIO_DIRECT_MODEL,
    resolverRoute: input.route,
    sourceVariants: MANHUA_NATIVE_AUDIO_DIRECT_SOURCE_VARIANTS,
    alignmentMethod: MANHUA_NATIVE_AUDIO_DIRECT_ALIGNMENT,
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

/**
 * 新一代直读音轨装配：每个视觉分段返回一份局部秒位的音轨裁决
 * （chunkIndex=段号），这里做代码侧校验、绝对秒换算与整集合并。
 * 任一段缺失、重复或秒位不齐都关闭式拒绝——不写半截音轨。
 */
export function finalizeManhuaNativeDirectAudioAnalysis(input: {
  durationSec: number;
  /** 视觉分段边界（绝对秒），与 chunkIndex 一一对应。 */
  chunks: readonly ManhuaNativeAudioChunk[];
  resolvedChunks: ReadonlyArray<{ chunkIndex: number; analysis: unknown }>;
  usage: ManhuaNativeAudioUsage;
  route: ManhuaNativeAudioDirectRoute;
}): ManhuaNativeAudioAnalysis {
  const expectedIndexes = input.chunks.map((row) => row.index).sort((a, b) => a - b);
  const resolvedByIndex = new Map<number, unknown>();
  for (const row of input.resolvedChunks) {
    if (resolvedByIndex.has(row.chunkIndex)) {
      throw new Error(`原生直读重复返回第${row.chunkIndex + 1}段音轨，拒绝入库`);
    }
    resolvedByIndex.set(row.chunkIndex, row.analysis);
  }
  const actualIndexes = Array.from(resolvedByIndex.keys()).sort((a, b) => a - b);
  if (JSON.stringify(actualIndexes) !== JSON.stringify(expectedIndexes)) {
    throw new Error("原生直读未返回完整的分段音轨，拒绝入库");
  }
  const chunks = input.chunks.map((chunk) =>
    normalizeManhuaNativeAudioChunkAnalysis({
      raw: resolvedByIndex.get(chunk.index),
      chunk,
    }),
  );
  return mergeManhuaNativeDirectAudioChunks({
    durationSec: input.durationSec,
    chunks,
    usage: input.usage,
    route: input.route,
  });
}

/** 素材确无音轨时的新一代空音轨结构；与直读卡同一套 provenance 常量。 */
export function noAudioManhuaNativeDirectAnalysis(
  durationSec: number,
  route: ManhuaNativeAudioDirectRoute,
): ManhuaNativeAudioAnalysis {
  return {
    ...noAudioManhuaNativeAnalysis(durationSec),
    model: MANHUA_NATIVE_AUDIO_DIRECT_MODEL,
    resolverModel: MANHUA_NATIVE_AUDIO_DIRECT_MODEL,
    resolverRoute: route,
    sourceVariants: MANHUA_NATIVE_AUDIO_DIRECT_SOURCE_VARIANTS,
    alignmentMethod: MANHUA_NATIVE_AUDIO_DIRECT_ALIGNMENT,
  };
}

/** GCS 卡片读取门：来源代际、合并器、时间轴和用量证据缺一不可。两代卡都要能读。 */
export function parseManhuaNativeAudioAnalysis(raw: unknown): ManhuaNativeAudioAnalysis | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Partial<ManhuaNativeAudioAnalysis>;
  const durationSec = Math.max(1, Math.floor(Number(o.durationSec) || 0));
  const isLegacyDual =
    o.model === MANHUA_NATIVE_AUDIO_MODEL
    && o.resolverModel === MANHUA_NATIVE_AUDIO_RESOLVER_MODEL
    && o.resolverRoute === MANHUA_NATIVE_AUDIO_RESOLVER_ROUTE
    && o.alignmentMethod === MANHUA_NATIVE_AUDIO_ALIGNMENT
    && JSON.stringify(o.sourceVariants) === JSON.stringify(MANHUA_NATIVE_AUDIO_SOURCE_VARIANTS);
  const isDirect =
    o.model === MANHUA_NATIVE_AUDIO_DIRECT_MODEL
    && o.resolverModel === MANHUA_NATIVE_AUDIO_DIRECT_MODEL
    && MANHUA_NATIVE_AUDIO_DIRECT_ROUTES.includes(o.resolverRoute as ManhuaNativeAudioDirectRoute)
    && o.alignmentMethod === MANHUA_NATIVE_AUDIO_DIRECT_ALIGNMENT
    && JSON.stringify(o.sourceVariants)
      === JSON.stringify(MANHUA_NATIVE_AUDIO_DIRECT_SOURCE_VARIANTS);
  if ((!isLegacyDual && !isDirect) || typeof o.hasAudio !== "boolean") return undefined;
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
    // 旧双路完整性下限：每段至少 2 次成功调用（0826 起门禁重试会诚实多计，只卡下限）。
    // 新直读：每段至少 1 次视觉调用；audioInputTokens 取自视觉回执的 AUDIO modality，
    // Vertex 主线必须 >0（实测 360s 段音频 ≈9,001 tok）；EvoLink 兜底是否回报
    // modality 明细未实测，不据此拒卡。
    const callsFloor = isLegacyDual ? chunkCount * 2 : chunkCount;
    const requireAudioTokens = isLegacyDual || o.resolverRoute === "vertex_gcs_video";
    if (
      chunkCount < 1 || usage.geminiCalls < callsFloor
      || (requireAudioTokens && usage.audioInputTokens <= 0) || !usage.receiptComplete
      || !cut(o.audioBeatStructureZh, 1_000) || !cut(o.reusableAudioZh, 1_000)
      || !cut(o.genAudioHintZh, 1_000)
    ) return undefined;
  } else if (chunkCount !== 0 || audioTrack.length !== 0 || usage.geminiCalls) {
    return undefined;
  }
  return {
    model: o.model!,
    resolverModel: o.resolverModel!,
    resolverRoute: o.resolverRoute!,
    sourceVariants: (isLegacyDual
      ? MANHUA_NATIVE_AUDIO_SOURCE_VARIANTS
      : MANHUA_NATIVE_AUDIO_DIRECT_SOURCE_VARIANTS),
    hasAudio: o.hasAudio,
    alignmentMethod: o.alignmentMethod!,
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
