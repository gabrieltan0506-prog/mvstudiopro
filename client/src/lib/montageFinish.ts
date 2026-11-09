/**
 * 剪辑方案「采用」时可选的调色与转场草稿。字段与校验直接复用 @shared/colorGrade 的
 * concatGradeSchema（服务端 concat 同一份契约）：grade = { all?, clips?[与片段一一对应], referenceClipIndex? }，
 * 每项为 ColorCorrection（lutId/exposure/contrast/gamma 系列/saturation/color_temperature/color_balance/curves）。
 * 中性值不下发，旧 concat 行为不变。
 */
import { COLOR_GRADE_ADVISOR_HELP, COLOR_GRADE_LUT_GROUPS, concatGradeSchema, type ColorCorrection, type ConcatGrade } from "@shared/colorGrade";

export type { ColorCorrection, ConcatGrade };
export type MontageTransitionKind = "none" | "fade" | "dissolve" | "wipeleft";
export type MontageTransition = { kind: MontageTransitionKind; durationSec: number };
export type MontageFinish = { grade?: ConcatGrade; transition?: MontageTransition };

/** 预设 LUT：真源在 @shared/colorGrade（顾问提示与服务端白名单同一份），id 与 server/assets/luts/manifest.json 一致（测试对账）。 */
export const MONTAGE_LUT_GROUPS = COLOR_GRADE_LUT_GROUPS;
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
  COLOR_GRADE_ADVISOR_HELP + "转场写入transitionSettings{kind:none|fade|dissolve|wipeleft,durationSec .1–2}，或transition=cut|fade|dissolve|wipeleft。调色与转场按剪辑方案各存一份（episode=方案序号）。有同步字幕或单段方案时只能直接切换。只写草稿，须用户点采用才生成。";

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

/** 每个剪辑方案各存一份草稿：键 = 「方案序号:标题」（序号从1起）。 */
export const montageFinishKey = (planIndex: number, title: string) => `${planIndex + 1}:${title}`;

/** 读回全部方案草稿；任一份格式错误返回 null（不猜）。 */
export function readMontageFinishes(value: unknown): Record<string, MontageFinish> | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const out: Record<string, MontageFinish> = {};
  for (const [k, v] of Object.entries(value)) {
    const f = readMontageFinish(v);
    if (f === null) return null;
    out[k] = f;
  }
  return out;
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
  action: { operation: string; transition?: unknown; transitionSettings?: unknown; grade?: unknown },
  cutCount?: number
): MontageFinish {
  if (action.operation === "transition") {
    const keep = current.transition?.durationSec ?? MONTAGE_TRANSITION_RANGE.default;
    if (action.transitionSettings !== undefined) return { ...current, transition: normalizeMontageTransition(action.transitionSettings) };
    if (action.transition === "cut") return { ...current, transition: { kind: "none", durationSec: keep } };
    if (action.transition === "fade" || action.transition === "dissolve" || action.transition === "wipeleft")
      return { ...current, transition: { kind: action.transition, durationSec: keep } };
    throw new Error("转场设置缺少类型");
  }
  if (action.operation === "grade") {
    if (action.grade === undefined) throw new Error("调色设置缺少参数");
    if (action.grade === null) return { ...current, grade: undefined };
    const grade = normalizeMontageGrade(action.grade);
    // 写入即核对本方案切点数，不符直接拒绝（不等到采用时才报错）。
    if (cutCount != null && grade.clips && grade.clips.length !== cutCount)
      throw new Error(`逐段调色有${grade.clips.length}项，本方案有${cutCount}个切点，须一一对应，未改动`);
    if (cutCount != null && grade.referenceClipIndex != null && grade.referenceClipIndex >= cutCount)
      throw new Error(`代表镜头第${grade.referenceClipIndex + 1}段超出本方案${cutCount}个切点，未改动`);
    return { ...current, grade };
  }
  throw new Error("该操作不是调色或转场设置");
}
