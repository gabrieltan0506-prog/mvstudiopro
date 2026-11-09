/**
 * 剪辑方案「采用」时可选的调色与转场草稿。字段与校验直接复用 @shared/colorGrade 的
 * concatGradeSchema（服务端 concat 同一份契约）：grade = { all?, clips?[与片段一一对应], referenceClipIndex? }，
 * 每项为 ColorCorrection（lutId/exposure/contrast/gamma 系列/saturation/color_temperature/color_balance/curves）。
 * 中性值不下发，旧 concat 行为不变。
 */
import { concatGradeSchema, type ColorCorrection, type ConcatGrade } from "@shared/colorGrade";

export type { ColorCorrection, ConcatGrade };
export type MontageTransitionKind = "none" | "fade" | "dissolve" | "wipeleft";
export type MontageTransition = { kind: MontageTransitionKind; durationSec: number };
export type MontageFinish = { grade?: ConcatGrade; transition?: MontageTransition };

/**
 * 预设 LUT：id 与 server/assets/luts/manifest.json 一致（测试对账）；按类别分组、组内固定顺序。
 * 强度以「轻/标准」两档预设区分（服务端不收单独强度值）。
 */
export const MONTAGE_LUT_GROUPS: ReadonlyArray<{ label: string; presets: ReadonlyArray<{ id: string; label: string }> }> = [
  { label: "电影氛围", presets: [
    { id: "nordic_desaturation_subtle", label: "冷灰低饱和 · 轻" },
    { id: "nordic_desaturation_standard", label: "冷灰低饱和 · 标准" },
    { id: "golden_hour_subtle", label: "暖阳黄昏 · 轻" },
    { id: "golden_hour_standard", label: "暖阳黄昏 · 标准" },
    { id: "neo_noir_subtle", label: "暗调黑色电影 · 轻" },
    { id: "neo_noir_standard", label: "暗调黑色电影 · 标准" },
    { id: "cyberpunk_neon_subtle", label: "霓虹雨夜 · 轻" },
    { id: "cyberpunk_neon_standard", label: "霓虹雨夜 · 标准" },
    { id: "dream_sequence_subtle", label: "梦境柔光 · 轻" },
    { id: "dream_sequence_standard", label: "梦境柔光 · 标准" },
    { id: "vintage_film_fade_subtle", label: "复古褪色 · 轻" },
    { id: "vintage_film_fade_standard", label: "复古褪色 · 标准" },
  ] },
  { label: "胶片质感", presets: [
    { id: "film_warm_print", label: "暖调印片" },
    { id: "film_punchy_consumer", label: "鲜艳民用胶片" },
    { id: "film_35mm_prestige", label: "35mm 院线质感" },
    { id: "film_super8", label: "怀旧家庭录像" },
  ] },
  { label: "基础校色", presets: [
    { id: "basic_split_tone_teal_orange", label: "冷暗暖亮分离" },
    { id: "basic_warm", label: "整体偏暖" },
    { id: "basic_cool", label: "整体偏冷" },
    { id: "basic_desaturate", label: "压饱和" },
  ] },
];
export const MONTAGE_LUT_IDS: ReadonlyArray<string> = MONTAGE_LUT_GROUPS.flatMap(g => g.presets.map(p => p.id));

/** 滑杆范围（schema 允许更宽，界面取常用段）。 */
export const MONTAGE_GRADE_SLIDERS = {
  saturation: { label: "饱和度", min: 0, max: 2, step: 0.05, neutral: 1 },
  color_temperature: { label: "色温", min: 2000, max: 12000, step: 100, neutral: 6500 },
  contrast: { label: "对比度", min: 0.5, max: 2, step: 0.05, neutral: 1 },
} as const;
export type MontageSliderKey = keyof typeof MONTAGE_GRADE_SLIDERS;
const NEUTRAL: Partial<Record<keyof ColorCorrection, number>> = { exposure: 0, contrast: 1, saturation: 1, color_temperature: 6500, gamma: 1, gamma_r: 1, gamma_g: 1, gamma_b: 1 };

export const MONTAGE_TRANSITION_RANGE = { min: 0.1, max: 2, step: 0.1, default: 0.5 } as const;
export const MONTAGE_TRANSITION_LABELS: Record<MontageTransitionKind, string> = {
  none: "直接切换",
  fade: "淡入淡出",
  dissolve: "溶解",
  wipeleft: "左划",
};

/** 交给顾问 inspect 的约定说明（方向与范围），不含引擎/供应商字样。 */
export const MONTAGE_FINISH_ADVISOR_HELP =
  "调色写入grade={all?:校正,clips?:[每切点一项或null，数量须等于本方案切点数],referenceClipIndex?:代表镜头(从0起)}；校正字段：lutId取lutOptions(轻/标准两档即强度)；exposure -0.95–3档(0中性)；contrast .2–3(1中性)；gamma/gamma_r/g/b .1–10(1中性)；saturation 0–3(1中性，<1压低饱和)；color_temperature 1000–40000K(6500中性，越低越暖、越高越冷)；color_balance{shadows,midtones,highlights:{r,g,b -1–1}}；curves{master,r,g,b:\"0/0 .5/.45 1/1\"}。转场写入transitionSettings{kind:none|fade|dissolve|wipeleft,durationSec .1–2}，或沿用transition=cut|fade。有同步字幕或单段方案时只能直接切换。只写草稿，须用户点采用才生成。";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

function stripNeutral(c: ColorCorrection | null | undefined): ColorCorrection | null {
  if (!c) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if (v === undefined) continue;
    if (NEUTRAL[k as keyof ColorCorrection] === v) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? (out as ColorCorrection) : null;
}

/** 校验并整理调色（共享契约 + 预设白名单）；未知字段由 strict schema 拒绝。 */
export function normalizeMontageGrade(value: unknown): ConcatGrade {
  const parsed = concatGradeSchema.safeParse(value);
  if (!parsed.success) throw new Error(`调色参数不符合要求：${parsed.error.issues.map(i => `${i.path.join(".") || "grade"} ${i.message}`).join("；")}`);
  const grade = parsed.data;
  for (const c of [grade.all, ...(grade.clips ?? [])])
    if (c?.lutId && !MONTAGE_LUT_IDS.includes(c.lutId)) throw new Error(`调色预设不存在：${c.lutId}`);
  return grade;
}

export function normalizeMontageTransition(value: unknown): MontageTransition {
  if (!isRecord(value)) throw new Error("转场参数格式错误");
  const kind = value.kind;
  if (!["none", "fade", "dissolve", "wipeleft"].includes(kind as string)) throw new Error("转场只支持直接切换、淡入淡出、溶解、左划");
  const d = value.durationSec === undefined ? MONTAGE_TRANSITION_RANGE.default : value.durationSec;
  if (typeof d !== "number" || !Number.isFinite(d) || d < MONTAGE_TRANSITION_RANGE.min || d > MONTAGE_TRANSITION_RANGE.max) throw new Error("转场时长须在0.1–2秒");
  return { kind: kind as MontageTransitionKind, durationSec: Math.round(d * 10) / 10 };
}

/** 草稿读回：缺省视为未设置；格式错误返回 null，由调用方按草稿错误处理。 */
export function readMontageFinish(value: unknown): MontageFinish | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  try {
    return {
      ...(value.grade !== undefined ? { grade: normalizeMontageGrade(value.grade) } : {}),
      ...(value.transition !== undefined ? { transition: normalizeMontageTransition(value.transition) } : {}),
    };
  } catch {
    return null;
  }
}

/** 界面滑杆/下拉改全片校正：回到中性即删除该键。 */
export function patchMontageGradeAll(grade: ConcatGrade | undefined, patch: Partial<ColorCorrection>): ConcatGrade | undefined {
  const all = stripNeutral({ ...(grade?.all ?? {}), ...patch } as ColorCorrection);
  const next: ConcatGrade = { ...(grade ?? {}) };
  if (all) next.all = all;
  else delete next.all;
  return Object.keys(next).length ? next : undefined;
}

export function montageTransitionBlockReason(cutCount: number, hasSubtitles: boolean): string {
  if (hasSubtitles) return "本方案带同步对白字幕，只能直接切换（转场会错开字幕时间）";
  if (cutCount < 2) return "单段方案没有镜头衔接，只能直接切换";
  return "";
}

/** 组装 concat 的可选参数：中性/禁用时不带字段；逐段数量与切点不符直接报错，不猜。 */
export function montageFinishParams(
  finish: MontageFinish | undefined,
  cutCount: number,
  hasSubtitles: boolean
): { grade?: ConcatGrade; transition?: { kind: "fade" | "dissolve" | "wipeleft"; durationSec: number } } {
  const out: ReturnType<typeof montageFinishParams> = {};
  const g = finish?.grade;
  if (g) {
    if (g.clips && g.clips.length !== cutCount) throw new Error(`逐段调色有${g.clips.length}项，本方案有${cutCount}个切点，请重新设置`);
    if (g.referenceClipIndex != null && g.referenceClipIndex >= cutCount) throw new Error("代表镜头不在本方案切点范围内，请重新设置");
    const all = stripNeutral(g.all);
    const clips = g.clips?.map(stripNeutral);
    const grade: ConcatGrade = {
      ...(all ? { all } : {}),
      ...(clips?.some(Boolean) ? { clips } : {}),
      ...(g.referenceClipIndex != null && cutCount > 1 ? { referenceClipIndex: g.referenceClipIndex } : {}),
    };
    if (grade.all || grade.clips) out.grade = grade;
  }
  const t = finish?.transition;
  if (t && t.kind !== "none" && !montageTransitionBlockReason(cutCount, hasSubtitles))
    out.transition = { kind: t.kind, durationSec: t.durationSec };
  return out;
}

/**
 * 顾问自然语言 → 草稿：接受现有 edit.transition=cut|fade，
 * 以及约定扩展 transitionSettings / operation=grade+grade（共享动作契约放开后生效）。返回新 finish，不提交。
 */
export function applyAdvisorMontageFinish(
  current: MontageFinish,
  action: { operation: string; transition?: unknown; transitionSettings?: unknown; grade?: unknown }
): MontageFinish {
  if (action.operation === "transition") {
    const keep = current.transition?.durationSec ?? MONTAGE_TRANSITION_RANGE.default;
    if (action.transitionSettings !== undefined) return { ...current, transition: normalizeMontageTransition(action.transitionSettings) };
    if (action.transition === "cut") return { ...current, transition: { kind: "none", durationSec: keep } };
    if (action.transition === "fade") return { ...current, transition: { kind: "fade", durationSec: keep } };
    throw new Error("转场设置缺少类型");
  }
  if (action.operation === "grade") {
    if (action.grade === undefined) throw new Error("调色设置缺少参数");
    if (action.grade === null) return { ...current, grade: undefined };
    return { ...current, grade: normalizeMontageGrade(action.grade) };
  }
  throw new Error("该操作不是调色或转场设置");
}
