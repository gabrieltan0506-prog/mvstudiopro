/**
 * 1110 成片调色建议：Gemini（缺省 3.8 Flash，env 可配，见 resolveMontageGradeAdviceModel）看成片（视频+音轨）给逐段调色方案。
 * 通道（用户定案）：Vertex gs:// 直读 → EvoLink 签名 URL；禁止 Pro / 直连 API key / GLM / DeepSeek。
 * 复用 gemini-audio.ts geminiAudioJsonWithFallback（超时/断线/HTTP 错/空回/写坏都换下一跳，每跳原始与解析 JSON 分别永久落 GCS）。
 * 指令与 schema 沿用 1109 已验证探针（/home/claude/grade-advice/prompt.json），只把剧情时间线、时长、接点改为入参。
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { colorCorrectionSchema, type ColorCorrection } from "../../shared/colorGrade";
import { geminiAudioJsonWithFallback } from "../gemini-audio";
import { downloadGcsObjectVersioned, getGcsBucketName, signGsUriV4ReadUrl, uploadBufferToGcsIfAbsent } from "./gcs";
import { resolveGeminiModel, type GeminiModelEnv } from "../../shared/geminiModelConfig.js";

/**
 * 1110 模型不写死（用户定案：调色建议只用 Gemini，缺省 3.8 Flash）：
 * env MONTAGE_GRADE_ADVICE_MODEL → GEMINI_DEFAULT_MODEL → gemini-3.8-flash；Pro 级需用户批准（解析时告警）。
 */
export function resolveMontageGradeAdviceModel(env?: GeminiModelEnv): string {
  return resolveGeminiModel("montageGradeAdvice", env);
}
const LUT_MANIFEST_PATH = fileURLToPath(new URL("../assets/luts/manifest.json", import.meta.url));

export type LutOption = { id: string; labelZh: string };

export async function loadGradeLutOptions(manifestPath = LUT_MANIFEST_PATH): Promise<LutOption[]> {
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((e): e is { id: string; labelZh?: string } => !!e && typeof (e as { id?: unknown }).id === "string")
    .map(e => ({ id: e.id, labelZh: String(e.labelZh || e.id) }));
}

const sec = z.number().finite().min(0);
const segmentNowSchema = z.object({
  fromSec: sec, toSec: sec,
  storyZh: z.string(), exposureZh: z.string(), colorTempZh: z.string(), saturationZh: z.string(), contrastZh: z.string(),
  moodMatch: z.enum(["match", "partial", "mismatch"]), moodMatchZh: z.string(),
}).strict();
/** intent：intended = 剧情意图的转变（不修）；unwanted = 不该有的跳色（自动修正只修这类）。 */
const seamSchema = z.object({ atSec: sec, jump: z.boolean(), intent: z.enum(["intended", "unwanted"]), beforeZh: z.string(), afterZh: z.string(), fixZh: z.string() }).strict();
const gradeRowSchema = z.object({ fromSec: sec, toSec: sec, correction: colorCorrectionSchema, reasonZh: z.string().min(1) }).strict();

export const montageGradeAdviceSchema = z.object({
  segmentsNow: z.array(segmentNowSchema).min(1).max(40),
  seams: z.array(seamSchema).max(40),
  grades: z.array(gradeRowSchema).min(1).max(40),
  arcZh: z.string().min(1),
}).strict();
export type MontageGradeAdvice = z.infer<typeof montageGradeAdviceSchema>;

/** 可直接喂 concat grade.segments 的结构（[{startSec,endSec,junctionIntent?,...ColorCorrection}]）；junctionIntent 为进本段接点的意图。 */
export type GradeSegment = { startSec: number; endSec: number; junctionIntent?: "intended" | "unwanted" } & ColorCorrection;
/** 段起点与 seams[].atSec 相差在此秒数内视为同一接点。 */
export const SEAM_MATCH_TOLERANCE_SEC = 0.6;

/** 校验：参数过 colorCorrectionSchema；LUT 必须在 manifest；区间按时间顺序连续覆盖 0..duration、不重叠不留空（容差 0.15s）。 */
export function validateMontageGradeAdvice(value: unknown, ctx: { durationSec: number; lutIds: Set<string> }): MontageGradeAdvice {
  const advice = montageGradeAdviceSchema.parse(value);
  const issues: string[] = [];
  const tol = 0.15;
  let cursor = 0;
  advice.grades.forEach((g, i) => {
    if (g.toSec <= g.fromSec) issues.push(`第${i + 1}段区间倒置`);
    if (Math.abs(g.fromSec - cursor) > tol) issues.push(`第${i + 1}段起点 ${g.fromSec} 与上一段终点 ${cursor} 不连续`);
    if (g.correction.lutId && !ctx.lutIds.has(g.correction.lutId)) issues.push(`第${i + 1}段 LUT「${g.correction.lutId}」不在预设清单`);
    cursor = g.toSec;
  });
  if (Math.abs(cursor - ctx.durationSec) > tol) issues.push(`末段终点 ${cursor} 未覆盖到片尾 ${ctx.durationSec}`);
  if (issues.length) throw new Error(issues.join("；"));
  return advice;
}

/**
 * 建议段 → concat grade.segments；每段起点就近（±SEAM_MATCH_TOLERANCE_SEC）对上 seams 的接点意图，透传为 junctionIntent；对不上不填（自动修正视为未提供意图，不修）。
 * seamLookupSecs（可选，吸附后用）：第 i 段额外的对点时刻（模型原始边界），吸附挪走边界后仍能对上模型在原处标的接点意图。
 */
export function adviceToGradeSegments(advice: MontageGradeAdvice, durationSec: number, seamLookupSecs?: number[][]): GradeSegment[] {
  return advice.grades.map((g, i, all) => {
    const at = [g.fromSec, ...(seamLookupSecs?.[i] ?? [])];
    const dist = (s: { atSec: number }) => Math.min(...at.map(t => Math.abs(s.atSec - t)));
    const seam = i === 0 ? undefined : advice.seams
      .filter(s => dist(s) <= SEAM_MATCH_TOLERANCE_SEC)
      .sort((a, b) => dist(a) - dist(b))[0];
    return {
      startSec: i === 0 ? 0 : g.fromSec,
      endSec: i === all.length - 1 ? durationSec : g.toSec,
      ...(seam ? { junctionIntent: seam.intent } : {}),
      ...g.correction,
    };
  });
}

/** 已知转场：atSec = 转场中点（成片绝对秒），durationSec = 转场时长；转场区间 = atSec ± durationSec/2。 */
export type GradeTransition = { atSec: number; durationSec: number };
/** 分段边界吸附到切点的容差（秒）：离最近切点在此范围内才吸附。 */
export const GRADE_SNAP_TOLERANCE_SEC = 1.5;
/** 转场让位范围（秒）：转场区间前后此秒数内的分段边界一律让位给转场中点，即使该边界本身落在切点上。 */
export const GRADE_TRANSITION_YIELD_SEC = 3;
/** 建议过渡时长上限（秒）＝ shared/colorGrade.ts gradeSegmentSchema.crossfadeSec 的上限；超出截断。 */
export const GRADE_CROSSFADE_MAX_SEC = 2;
/** 吸附后的段长下限（秒）＝ validateMontageGradeAdvice 的连续性容差；短于它的段并入相邻段。 */
export const GRADE_SEGMENT_MIN_SEC = 0.15;

export type GradeBoundarySnap = {
  /** 边界 = 模型原始 grades[gradeIndex] 的起点（gradeIndex ≥ 1）。 */
  gradeIndex: number;
  originalSec: number;
  snappedSec: number;
  snappedTo: "cut" | "transition" | "none";
  /** true＝超出容差，保留模型原值。 */
  unsnapped?: true;
  /** 吸到转场中点时建议的该处段间过渡时长（= 转场时长，秒；超过 GRADE_CROSSFADE_MAX_SEC 截断）。 */
  suggestedCrossfadeSec?: number;
  /** 吸附合并后以该边界为起点的段在 segments 里的下标；该边界因合并消失则为 null。 */
  segmentIndex: number | null;
};
type GradeRow = MontageGradeAdvice["grades"][number];
export type GradeSnapReport = {
  toleranceSec: number;
  /** 转场让位范围（秒）；旧证据无此字段。 */
  transitionYieldSec?: number;
  minSegmentSec: number;
  seamSecs: number[];
  transitions: GradeTransition[];
  boundaries: GradeBoundarySnap[];
  /** 吸附后段长不足而并入相邻段的模型原始段下标。 */
  mergedGradeIndexes: number[];
  gradesBefore: GradeRow[];
  gradesAfter: GradeRow[];
  segmentsBefore: GradeSegment[];
  /** 吸附结果未过校验时回退为吸附前分段，此处写原因。 */
  fallbackZh?: string;
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * 确定性吸附（不调模型）：
 * 1) 边界落在某转场区间内或其前后 GRADE_TRANSITION_YIELD_SEC 内 → 让位给该转场中点（即使边界本身就是切点；多个命中取中点最近的），
 *    并给出建议过渡时长（转场时长，上限 GRADE_CROSSFADE_MAX_SEC）；
 * 2) 否则吸到最近切点（±GRADE_SNAP_TOLERANCE_SEC）；
 * 3) 都够不着 → 保留原值并标 unsnapped。
 * 吸附后重排为首尾相接、覆盖 0..durationSec；段长 < GRADE_SEGMENT_MIN_SEC 的段并入相邻段（丢弃该段调色参数，前后段直接相接）。
 */
export function snapGradeBoundaries(
  grades: GradeRow[],
  ctx: { durationSec: number; seamSecs?: number[]; transitions?: GradeTransition[] },
): { grades: GradeRow[]; originalFromSecs: number[]; boundaries: GradeBoundarySnap[]; mergedGradeIndexes: number[] } {
  const inside = (t: number) => Number.isFinite(t) && t > 0 && t < ctx.durationSec;
  const cuts = (ctx.seamSecs ?? []).filter(inside);
  const transitions = (ctx.transitions ?? []).filter(t => inside(t.atSec) && Number.isFinite(t.durationSec) && t.durationSec >= 0);
  const eps = 1e-6;
  const boundaries: GradeBoundarySnap[] = [];
  for (let i = 1; i < grades.length; i++) {
    const b = grades[i]!.fromSec;
    const tr = transitions
      .filter(t => Math.abs(b - t.atSec) <= t.durationSec / 2 + GRADE_TRANSITION_YIELD_SEC + eps)
      .sort((x, y) => Math.abs(b - x.atSec) - Math.abs(b - y.atSec))[0];
    if (tr) {
      boundaries.push({ gradeIndex: i, originalSec: b, snappedSec: r3(tr.atSec), snappedTo: "transition", suggestedCrossfadeSec: Math.min(tr.durationSec, GRADE_CROSSFADE_MAX_SEC), segmentIndex: null });
      continue;
    }
    const cut = cuts.filter(c => Math.abs(b - c) <= GRADE_SNAP_TOLERANCE_SEC + eps).sort((x, y) => Math.abs(b - x) - Math.abs(b - y))[0];
    boundaries.push(cut === undefined
      ? { gradeIndex: i, originalSec: b, snappedSec: b, snappedTo: "none", unsnapped: true, segmentIndex: null }
      : { gradeIndex: i, originalSec: b, snappedSec: r3(cut), snappedTo: "cut", segmentIndex: null });
  }
  const edge = [0, ...boundaries.map(x => x.snappedSec), ctx.durationSec];
  const kept: Array<{ index: number; row: GradeRow }> = [];
  const mergedGradeIndexes: number[] = [];
  let cursor = 0;
  grades.forEach((g, i) => {
    const end = Math.min(ctx.durationSec, Math.max(cursor, edge[i + 1]!));
    if (end - cursor < GRADE_SEGMENT_MIN_SEC) { mergedGradeIndexes.push(i); return; }
    kept.push({ index: i, row: { ...g, fromSec: cursor, toSec: end } });
    cursor = end;
  });
  if (!kept.length) {
    // 全片短于段长下限：保留首段覆盖全片。
    kept.push({ index: 0, row: { ...grades[0]!, fromSec: 0, toSec: ctx.durationSec } });
    mergedGradeIndexes.splice(mergedGradeIndexes.indexOf(0), 1);
  }
  kept[kept.length - 1]!.row.toSec = ctx.durationSec;
  for (const b of boundaries) {
    const pos = kept.findIndex(k => k.index === b.gradeIndex);
    b.segmentIndex = pos > 0 ? pos : null;
  }
  return { grades: kept.map(k => k.row), originalFromSecs: kept.map(k => grades[k.index]!.fromSec), boundaries, mergedGradeIndexes };
}

export function buildMontageGradePrompt(input: { durationSec: number; aspect?: string; storyZh?: string; seamSecs?: number[]; transitions?: GradeTransition[]; luts: LutOption[] }): string {
  const d = input.durationSec.toFixed(1);
  const story = input.storyZh?.trim()
    ? `【剧情与歌曲情绪时间线（成片绝对秒，以此为准）】\n${input.storyZh.trim()}`
    : "【剧情与歌曲情绪】未提供文字说明，请完整看画面并听歌曲自行判断各段情绪。";
  const seams = input.seamSecs?.length
    ? `专门检查 ${input.seamSecs.map(s => `${s.toFixed(1)} 秒`).join("、")} 接点（素材拼接处）前后是否跳色/跳亮度，逐个描述并给出修法。`
    : "找出画面中明显的素材拼接接点，检查前后是否跳色/跳亮度，逐个描述并给出修法；没有则 seams 为空数组。";
  // 硬约束只在给了切点/转场时出现；都没给时提示词逐字不变。
  const boundaryRule = input.seamSecs?.length || input.transitions?.length
    ? `\n   【分段边界硬约束】除 0.0 与片尾 ${d} 外，grades 的分段边界只能落在给定切点或转场中点上，不得取其他时刻：${
      input.seamSecs?.length ? `\n   - 切点：${input.seamSecs.map(s => `${s.toFixed(1)} 秒`).join("、")}` : ""}${
      input.transitions?.length ? `\n   - 转场（中点／时长）：${input.transitions.map(t => `${t.atSec.toFixed(1)} 秒／${t.durationSec.toFixed(1)} 秒`).join("、")}；色调转变发生在某个转场附近时，边界必须取该转场中点，不得取它前后的切点` : ""}`
    : "";
  return `你是 MV 调色指导。审看这支${input.aspect ? ` ${input.aspect}` : ""}成片（时长 ${d} 秒），给出调色建议。全部中文，只输出一个严格 JSON 对象，不要 markdown、不要多余文字。

${story}

【可用调色工具（产品 concat grade 参数，只能用这些字段与取值）】
每段一个 correction 对象，字段全部可选：
- lutId：只能取下列 id 之一（id 已含档位，subtle=轻、standard=标准；无档位后缀的为固定单档），或不填
${input.luts.map(l => `- ${l.id}：${l.labelZh}`).join("\n")}
- exposure：曝光档（stops），-0.95..3，0 为不变
- contrast：0.2..3，1 为不变
- gamma、gamma_r、gamma_g、gamma_b：0.1..10，1 为不变
- saturation：0..3，1 为不变
- color_temperature：开尔文 1000..40000，6500 为中性；数值越低越暖、越高越冷
- color_balance：{shadows,midtones,highlights} 各为 {r,g,b}，每项 -1..1，0 为不变（建议幅度 ±0.15 以内）
- curves：{master,r,g,b} 各为点串字符串，形如 "0/0 0.25/0.22 0.75/0.8 1/1"，x/y 均为 0..1 小数，2..16 个点

【要求】
1. 先逐段描述成片现状：曝光、色温、饱和、对比各自有什么问题，与该段剧情情绪是否匹配。
2. ${seams}每个接点都要标 intent：
   - "intended"＝剧情意图的转变：这里的色调/亮度变化是叙事需要，应当保留（如挨耳光后转冷、回忆转入、雨落转暗、结尾转亮），通常发生在真实镜头切换且前后情绪明显不同处；
   - "unwanted"＝不该有的跳色：前后情绪与场景连续，只是素材之间曝光/色温/饱和不一致，或同一镜头内部突然变色变亮暗，观众会觉得是穿帮。
   拿不准时按画面所表达的情绪是否变化判断：情绪变了才是 intended。
3. 再给逐段调色方案：时间区间保留一位小数，按时间顺序连续覆盖 0.0–${d} 不重叠不留空；每段给 correction（只用上面的字段与合法取值）和理由。${boundaryRule}
4. 最后用一句话写全片光色弧线。

【输出 JSON schema】
{
  "segmentsNow": [{"fromSec": number, "toSec": number, "storyZh": string, "exposureZh": string, "colorTempZh": string, "saturationZh": string, "contrastZh": string, "moodMatch": "match"|"partial"|"mismatch", "moodMatchZh": string}],
  "seams": [{"atSec": number, "jump": boolean, "intent": "intended"|"unwanted", "beforeZh": string, "afterZh": string, "fixZh": string}],
  "grades": [{"fromSec": number, "toSec": number, "correction": {"lutId"?: string, "exposure"?: number, "contrast"?: number, "gamma"?: number, "gamma_r"?: number, "gamma_g"?: number, "gamma_b"?: number, "saturation"?: number, "color_temperature"?: number, "color_balance"?: {"shadows"?: {"r":number,"g":number,"b":number}, "midtones"?: {...}, "highlights"?: {...}}, "curves"?: {"master"?: string, "r"?: string, "g"?: string, "b"?: string}}, "reasonZh": string}],
  "arcZh": string
}

【输入】附件是成片视频（含音轨），请完整看画面并听歌曲。`;
}

export type MontageGradeAdviceInput = {
  requestId: string;
  videoGsUri: string;
  durationSec: number;
  aspect?: string;
  storyZh?: string;
  /** 成片切点（绝对秒）。给了它或 transitions：写进提示词硬约束，并对模型返回的分段边界做确定性吸附。 */
  seamSecs?: number[];
  /** 已知转场（atSec = 转场中点）。 */
  transitions?: GradeTransition[];
};

export type MontageGradeAdviceResult = {
  requestId: string;
  advice: MontageGradeAdvice;
  segments: GradeSegment[];
  usedBy: { channel: string; model: string; failuresZh: string[] };
  evidencePrefix: string;
  /** 仅在入参给了 seamSecs / transitions 时出现：分段边界吸附明细（segments 为吸附后；advice 保持模型原样）。 */
  snap?: GradeSnapReport;
  /** true＝同 requestId 已有最终结果，直接返回已存结果、未再调模型。 */
  replayed?: boolean;
};

/** 同 requestId 已登记但无最终结果（处理中/失败）：编号不可复用，须换新 requestId 重新发起。 */
export class MontageGradeAdviceRequestUsedError extends Error {
  constructor(requestId: string) {
    super(`调色建议请求 ${requestId} 已登记但无最终结果（处理中或已失败），编号不可复用`);
    this.name = "MontageGradeAdviceRequestUsedError";
  }
}

export type MontageGradeAdviceDeps = {
  call: typeof geminiAudioJsonWithFallback;
  upload: typeof uploadBufferToGcsIfAbsent;
  download: typeof downloadGcsObjectVersioned;
  bucket: () => string;
  sign: typeof signGsUriV4ReadUrl;
  luts: () => Promise<LutOption[]>;
};
const realDeps: MontageGradeAdviceDeps = {
  call: geminiAudioJsonWithFallback,
  upload: uploadBufferToGcsIfAbsent,
  download: downloadGcsObjectVersioned,
  bucket: getGcsBucketName,
  sign: signGsUriV4ReadUrl,
  luts: () => loadGradeLutOptions(),
};

/** 最终产物 segments.json（含 advice/usedBy）；缺失返回 null，形状不全视为无结果。 */
async function readStoredResult(d: MontageGradeAdviceDeps, bucket: string, prefix: string): Promise<MontageGradeAdviceResult | null> {
  let raw: unknown;
  try {
    raw = JSON.parse((await d.download({ gcsUri: `gs://${bucket}/${prefix}/segments.json` })).buffer.toString("utf8"));
  } catch (error) {
    if (error instanceof Error && /^gcs_(?:stat|download)_failed:404(?:$|:)/.test(error.message)) return null;
    throw error;
  }
  const r = raw as Partial<MontageGradeAdviceResult> | null;
  if (!r || !Array.isArray(r.segments) || !r.advice || !r.usedBy || typeof r.requestId !== "string") return null;
  return { requestId: r.requestId, advice: r.advice, segments: r.segments, usedBy: r.usedBy, evidencePrefix: String(r.evidencePrefix || `gs://${bucket}/${prefix}`), ...(r.snap ? { snap: r.snap } : {}) };
}

/**
 * 防重放：同 requestId 只调一次模型。
 * 1) 已有最终结果 → 直接返回已存结果（replayed），不调模型；扣费由调用方按同 chargeKey 幂等补扣。
 * 2) 否则先跑 beforeModelCall（余额预检，抛错则什么都不写），再以 request.json 条件创建（ifGenerationMatch=0）原子占号；
 *    占号失败 = 已登记：有结果则返回已存结果，无结果（处理中/失败）抛 MontageGradeAdviceRequestUsedError。
 * 因此每个 requestId 的原始/解析回包只落一次，证据只增不覆盖、永不删除。
 */
export async function adviseMontageGrade(
  userId: number,
  input: MontageGradeAdviceInput,
  deps: Partial<MontageGradeAdviceDeps> = {},
  opts: { beforeModelCall?: () => Promise<void> } = {},
): Promise<MontageGradeAdviceResult> {
  const d = { ...realDeps, ...deps };
  const bucket = d.bucket();
  const prefix = `canvas-montage/grade-advice/${userId}/${input.requestId}`;
  const stored = await readStoredResult(d, bucket, prefix);
  if (stored) return { ...stored, replayed: true };
  await opts.beforeModelCall?.();
  // 原始/解析 JSON 只增不覆盖、永不删除。
  const save = async (name: string, value: unknown) => {
    return d.upload({ bucket, objectName: `${prefix}/${name}.json`, buffer: Buffer.from(JSON.stringify(value)), contentType: "application/json" });
  };
  const model = resolveMontageGradeAdviceModel();
  const claim = await save("request", { userId, ...input, model });
  if (!claim.created) {
    const raced = await readStoredResult(d, bucket, prefix);
    if (raced) return { ...raced, replayed: true };
    throw new MontageGradeAdviceRequestUsedError(input.requestId);
  }
  const luts = await d.luts();
  const lutIds = new Set(luts.map(l => l.id));
  const prompt = buildMontageGradePrompt({ ...input, luts });
  const out = await d.call({
    media: { vertexFileUri: input.videoGsUri, evolinkFileUri: () => d.sign(input.videoGsUri, 2 * 3600) },
    mimeType: "video/mp4",
    model,
    prompt,
    schemaName: "montage_grade_advice",
    validate: v => validateMontageGradeAdvice(v, { durationSec: input.durationSec, lutIds }),
    save,
    maxOutputTokens: 32768,
    timeoutMs: 240_000,
  });
  let segments = adviceToGradeSegments(out.value, input.durationSec);
  let snap: GradeSnapReport | undefined;
  if (input.seamSecs?.length || input.transitions?.length) {
    const segmentsBefore = segments;
    const snapped = snapGradeBoundaries(out.value.grades, input);
    snap = {
      toleranceSec: GRADE_SNAP_TOLERANCE_SEC,
      transitionYieldSec: GRADE_TRANSITION_YIELD_SEC,
      minSegmentSec: GRADE_SEGMENT_MIN_SEC,
      seamSecs: input.seamSecs ?? [],
      transitions: input.transitions ?? [],
      boundaries: snapped.boundaries,
      mergedGradeIndexes: snapped.mergedGradeIndexes,
      gradesBefore: out.value.grades,
      gradesAfter: snapped.grades,
      segmentsBefore,
    };
    try {
      const after = validateMontageGradeAdvice({ ...out.value, grades: snapped.grades }, { durationSec: input.durationSec, lutIds });
      segments = adviceToGradeSegments(after, input.durationSec, snapped.originalFromSecs.map(t => [t]));
    } catch (error) {
      // 吸附结果不过校验：不丢已付费的模型结果，回退吸附前分段并写明原因。
      snap.fallbackZh = `吸附后校验未通过，沿用吸附前分段：${error instanceof Error ? error.message : String(error)}`;
      snap.gradesAfter = out.value.grades;
      snap.boundaries = snap.boundaries.map(b => ({ ...b, segmentIndex: b.gradeIndex }));
    }
    // 吸附前后分段分别落证据（模型原始回包已由各跳 hop-*-raw / parsed 落档）；只增不删。
    await save("snap-before", { grades: out.value.grades, segments: segmentsBefore });
    await save("snap-after", { ...snap, segments });
  }
  const result: MontageGradeAdviceResult = {
    requestId: input.requestId,
    advice: out.value,
    segments,
    ...(snap ? { snap } : {}),
    usedBy: { channel: out.channel, model: out.model, failuresZh: out.failuresZh },
    evidencePrefix: `gs://${bucket}/${prefix}`,
  };
  // 最终产物（重放据此原样返回）；channel/model 顶层保留旧字段。
  await save("segments", { ...result, channel: out.channel, model: out.model });
  return result;
}
