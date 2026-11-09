/**
 * 1110 成片调色建议：Gemini 3.8 Flash 看成片（视频+音轨）给逐段调色方案。
 * 通道（用户定案）：Vertex gs:// 直读 → EvoLink 签名 URL；禁止 Pro / 直连 API key / GLM / DeepSeek。
 * 复用 gemini-audio.ts geminiAudioJsonWithFallback（超时/断线/HTTP 错/空回/写坏都换下一跳，每跳原始与解析 JSON 分别永久落 GCS）。
 * 指令与 schema 沿用 1109 已验证探针（/home/claude/grade-advice/prompt.json），只把剧情时间线、时长、接点改为入参。
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { colorCorrectionSchema, type ColorCorrection } from "../../shared/colorGrade";
import { geminiAudioJsonWithFallback } from "../gemini-audio";
import { getGcsBucketName, signGsUriV4ReadUrl, uploadBufferToGcsIfAbsent } from "./gcs";

export const MONTAGE_GRADE_ADVICE_MODEL = "gemini-3.8-flash";
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
const seamSchema = z.object({ atSec: sec, jump: z.boolean(), beforeZh: z.string(), afterZh: z.string(), fixZh: z.string() }).strict();
const gradeRowSchema = z.object({ fromSec: sec, toSec: sec, correction: colorCorrectionSchema, reasonZh: z.string().min(1) }).strict();

export const montageGradeAdviceSchema = z.object({
  segmentsNow: z.array(segmentNowSchema).min(1).max(40),
  seams: z.array(seamSchema).max(40),
  grades: z.array(gradeRowSchema).min(1).max(40),
  arcZh: z.string().min(1),
}).strict();
export type MontageGradeAdvice = z.infer<typeof montageGradeAdviceSchema>;

/** 可直接喂 concat grade.segments 的结构（X 的 grade.segments 字段：[{startSec,endSec,...ColorCorrection}]）。 */
export type GradeSegment = { startSec: number; endSec: number } & ColorCorrection;

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

export function adviceToGradeSegments(advice: MontageGradeAdvice, durationSec: number): GradeSegment[] {
  return advice.grades.map((g, i, all) => ({
    startSec: i === 0 ? 0 : g.fromSec,
    endSec: i === all.length - 1 ? durationSec : g.toSec,
    ...g.correction,
  }));
}

export function buildMontageGradePrompt(input: { durationSec: number; aspect?: string; storyZh?: string; seamSecs?: number[]; luts: LutOption[] }): string {
  const d = input.durationSec.toFixed(1);
  const story = input.storyZh?.trim()
    ? `【剧情与歌曲情绪时间线（成片绝对秒，以此为准）】\n${input.storyZh.trim()}`
    : "【剧情与歌曲情绪】未提供文字说明，请完整看画面并听歌曲自行判断各段情绪。";
  const seams = input.seamSecs?.length
    ? `专门检查 ${input.seamSecs.map(s => `${s.toFixed(1)} 秒`).join("、")} 接点（素材拼接处）前后是否跳色/跳亮度，逐个描述并给出修法。`
    : "找出画面中明显的素材拼接接点，检查前后是否跳色/跳亮度，逐个描述并给出修法；没有则 seams 为空数组。";
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
2. ${seams}
3. 再给逐段调色方案：时间区间保留一位小数，按时间顺序连续覆盖 0.0–${d} 不重叠不留空；每段给 correction（只用上面的字段与合法取值）和理由。
4. 最后用一句话写全片光色弧线。

【输出 JSON schema】
{
  "segmentsNow": [{"fromSec": number, "toSec": number, "storyZh": string, "exposureZh": string, "colorTempZh": string, "saturationZh": string, "contrastZh": string, "moodMatch": "match"|"partial"|"mismatch", "moodMatchZh": string}],
  "seams": [{"atSec": number, "jump": boolean, "beforeZh": string, "afterZh": string, "fixZh": string}],
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
  seamSecs?: number[];
};

export type MontageGradeAdviceResult = {
  requestId: string;
  advice: MontageGradeAdvice;
  segments: GradeSegment[];
  usedBy: { channel: string; model: string; failuresZh: string[] };
  evidencePrefix: string;
};

export type MontageGradeAdviceDeps = {
  call: typeof geminiAudioJsonWithFallback;
  upload: typeof uploadBufferToGcsIfAbsent;
  bucket: () => string;
  sign: typeof signGsUriV4ReadUrl;
  luts: () => Promise<LutOption[]>;
};
const realDeps: MontageGradeAdviceDeps = {
  call: geminiAudioJsonWithFallback,
  upload: uploadBufferToGcsIfAbsent,
  bucket: getGcsBucketName,
  sign: signGsUriV4ReadUrl,
  luts: () => loadGradeLutOptions(),
};

export async function adviseMontageGrade(userId: number, input: MontageGradeAdviceInput, deps: Partial<MontageGradeAdviceDeps> = {}): Promise<MontageGradeAdviceResult> {
  const d = { ...realDeps, ...deps };
  const bucket = d.bucket();
  const prefix = `canvas-montage/grade-advice/${userId}/${input.requestId}`;
  // 原始/解析 JSON 只增不覆盖、永不删除。
  const save = async (name: string, value: unknown) => {
    await d.upload({ bucket, objectName: `${prefix}/${name}.json`, buffer: Buffer.from(JSON.stringify(value)), contentType: "application/json" });
  };
  const luts = await d.luts();
  const lutIds = new Set(luts.map(l => l.id));
  const prompt = buildMontageGradePrompt({ ...input, luts });
  await save("request", { userId, ...input, model: MONTAGE_GRADE_ADVICE_MODEL });
  const out = await d.call({
    media: { vertexFileUri: input.videoGsUri, evolinkFileUri: () => d.sign(input.videoGsUri, 2 * 3600) },
    mimeType: "video/mp4",
    model: MONTAGE_GRADE_ADVICE_MODEL,
    prompt,
    schemaName: "montage_grade_advice",
    validate: v => validateMontageGradeAdvice(v, { durationSec: input.durationSec, lutIds }),
    save,
    maxOutputTokens: 32768,
    timeoutMs: 240_000,
  });
  const segments = adviceToGradeSegments(out.value, input.durationSec);
  await save("segments", { segments, channel: out.channel, model: out.model });
  return {
    requestId: input.requestId,
    advice: out.value,
    segments,
    usedBy: { channel: out.channel, model: out.model, failuresZh: out.failuresZh },
    evidencePrefix: `gs://${bucket}/${prefix}`,
  };
}
