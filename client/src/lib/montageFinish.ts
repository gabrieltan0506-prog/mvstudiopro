/**
 * 剪辑方案「采用」时可选的调色与转场草稿。字段与校验直接复用 @shared/colorGrade 的
 * concatGradeSchema（服务端 concat 同一份契约）：grade = { all?, clips?[与片段一一对应], referenceClipIndex? }，
 * 每项为 ColorCorrection（lutId/exposure/contrast/gamma 系列/saturation/color_temperature/color_balance/curves）。
 * 中性值不下发，旧 concat 行为不变。
 */
import { COLOR_GRADE_ADVISOR_HELP, COLOR_GRADE_LUT_GROUPS, concatGradeSchema, validateGradeSegments, type ColorCorrection, type ConcatGrade, type GradeSegment } from "@shared/colorGrade";

export type { ColorCorrection, ConcatGrade };
export type MontageTransitionKind = "none" | "fade" | "dissolve" | "wipeleft";
export type MontageTransition = { kind: MontageTransitionKind; durationSec: number };
/**
 * 分段调色 = 共享 concatGradeSchema 的 segments（成片时间、一位小数、首尾相接）+ 段间渐变 crossfadeSec（0–2，全局一个值）
 * + autoMatchJunctions（接点未达标自动修正重渲一次）。界面额外要求首段从0起、末段到成片结尾（覆盖片长）。
 * 分段与逐段 clips/referenceClipIndex 互斥（服务端同规则）。
 */
export type MontageGradeSegment = GradeSegment;
export type MontageGrade = ConcatGrade;
export type MontageFinish = { grade?: MontageGrade; transition?: MontageTransition };
export const MONTAGE_CROSSFADE_RANGE = { min: 0, max: 2, step: 0.1 } as const;
export const MONTAGE_SEGMENT_MAX = 24;

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
  COLOR_GRADE_ADVISOR_HELP + "分段调色写入grade.segments=[{startSec,endSec,…校正}]（成片秒，一位小数，首段从0起、首尾相接、末段到成片结尾即inspect的outputSec，最多24段，不能与clips/referenceClipIndex/autoMatch同用），grade.crossfadeSec 0–2为段间渐变秒数（须短于每段），grade.autoMatchJunctions=true自动修正接点。" +
  "转场写入transitionSettings{kind:none|fade|dissolve|wipeleft,durationSec .1–2}，或transition=cut|fade|dissolve|wipeleft。调色与转场按剪辑方案各存一份（episode=方案序号）。有同步字幕或单段方案时只能直接切换。只写草稿，须用户点采用才生成。";

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

const isTenth = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v * 10 - Math.round(v * 10)) < 1e-6;
const tenth = (v: number) => Math.round(v * 10) / 10;

/** 分段须首段从0起、首尾相接不重叠、末段到成片结尾；段间渐变须短于每段。返回问题说明，空串=通过。 */
export function checkMontageSegments(segments: ReadonlyArray<MontageGradeSegment>, outputSec: number, crossfadeSec = 0): string {
  if (!segments.length) return "";
  if (segments[0].startSec !== 0) return "首段须从0秒开始";
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s.endSec - s.startSec < 0.1 - 1e-6) return `第${i + 1}段至少0.1秒`;
    if (i > 0 && Math.abs(s.startSec - segments[i - 1].endSec) > 1e-6)
      return s.startSec < segments[i - 1].endSec ? `第${i}段与第${i + 1}段重叠` : `第${i}段与第${i + 1}段之间有空档`;
    if (crossfadeSec > 0 && s.endSec - s.startSec < crossfadeSec - 1e-6) return `第${i + 1}段短于段间过渡秒数`;
  }
  const end = tenth(outputSec);
  if (Math.abs(segments[segments.length - 1].endSec - end) > 1e-6) return `末段须到成片结尾${end.toFixed(1)}秒`;
  return "";
}

/** 方案成片秒数：切点总长，实际下发重叠转场时扣除重叠部分（一位小数）。 */
export function montageOutputSec(cuts: ReadonlyArray<{ startSec: number; endSec: number }>, finish: MontageFinish | undefined, hasSubtitles: boolean): number {
  const total = cuts.reduce((n, c) => n + c.endSec - c.startSec, 0);
  const t = finish?.transition;
  const overlap = t && t.kind !== "none" && !montageTransitionBlockReason(cuts.length, hasSubtitles) ? (cuts.length - 1) * t.durationSec : 0;
  return tenth(total - overlap);
}

/** 校验并整理调色（共享契约 + 预设白名单）；未知字段由 strict schema 拒绝，分段结构走共享 validateGradeSegments。 */
export function normalizeMontageGrade(value: unknown): MontageGrade {
  const parsed = concatGradeSchema.safeParse(value);
  if (!parsed.success) throw new Error(`调色参数不符合要求：${parsed.error.issues.map(i => `${i.path.join(".") || "grade"} ${i.message}`).join("；")}`);
  const grade = parsed.data;
  const segErr = validateGradeSegments(grade);
  if (segErr) throw new Error(`调色参数不符合要求：${segErr}`);
  if (grade.segments && grade.segments.length > MONTAGE_SEGMENT_MAX) throw new Error(`分段调色最多${MONTAGE_SEGMENT_MAX}段`);
  for (const c of [grade.all, ...(grade.clips ?? []), ...(grade.segments ?? [])])
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
export function patchMontageGradeAll(grade: MontageGrade | undefined, patch: Partial<ColorCorrection>): MontageGrade | undefined {
  const all = stripNeutral({ ...(grade?.all ?? {}), ...patch } as ColorCorrection);
  const next: MontageGrade = { ...(grade ?? {}) };
  if (all) next.all = all;
  else delete next.all;
  return Object.keys(next).length ? next : undefined;
}

/** 分段编辑（界面）：返回新 grade；段数为0即删除 segments（回到全片调色）。 */
function withSegments(grade: MontageGrade | undefined, segments: MontageGradeSegment[] | undefined): MontageGrade | undefined {
  const next: MontageGrade = { ...(grade ?? {}) };
  if (segments && segments.length) next.segments = segments;
  else {
    // 服务端规定渐变/接点修正须配合分段使用
    delete next.segments;
    delete next.crossfadeSec;
    delete next.autoMatchJunctions;
  }
  return Object.keys(next).length ? next : undefined;
}
/** 新增分段：无分段时按成片一分为二；否则把最后一段对半拆开（一位小数）。 */
export function addMontageSegment(grade: MontageGrade | undefined, outputSec: number): MontageGrade | undefined {
  const segs = grade?.segments ?? [];
  if (segs.length >= MONTAGE_SEGMENT_MAX) return grade;
  if (!segs.length) {
    const end = tenth(outputSec), mid = tenth(end / 2);
    if (mid <= 0 || mid >= end) return grade;
    return withSegments(grade, [{ startSec: 0, endSec: mid }, { startSec: mid, endSec: end }]);
  }
  const last = segs[segs.length - 1], mid = tenth((last.startSec + last.endSec) / 2);
  if (mid <= last.startSec || mid >= last.endSec) return grade;
  return withSegments(grade, [...segs.slice(0, -1), { ...last, endSec: mid }, { startSec: mid, endSec: last.endSec }]);
}
/** 删除分段：时间并入相邻段保持连续；剩一段即回到全片调色。 */
export function removeMontageSegment(grade: MontageGrade | undefined, index: number): MontageGrade | undefined {
  const segs = [...(grade?.segments ?? [])];
  if (!segs[index]) return grade;
  const [gone] = segs.splice(index, 1);
  if (index > 0) segs[index - 1] = { ...segs[index - 1], endSec: gone.endSec };
  else if (segs[0]) segs[0] = { ...segs[0], startSec: gone.startSec };
  return withSegments(grade, segs.length > 1 ? segs : undefined);
}
/** 改某段：起止联动相邻段保持首尾相接；校正回到中性即删键。 */
export function patchMontageSegment(grade: MontageGrade | undefined, index: number, patch: Partial<MontageGradeSegment>): MontageGrade | undefined {
  const segs = [...(grade?.segments ?? [])];
  if (!segs[index]) return grade;
  const { startSec, endSec, ...rest } = { ...segs[index], ...patch };
  const correction = stripNeutral(rest as ColorCorrection) ?? {};
  segs[index] = { ...correction, startSec: tenth(startSec), endSec: tenth(endSec) };
  if (patch.startSec !== undefined && segs[index - 1]) segs[index - 1] = { ...segs[index - 1], endSec: segs[index].startSec };
  if (patch.endSec !== undefined && segs[index + 1]) segs[index + 1] = { ...segs[index + 1], startSec: segs[index].endSec };
  return withSegments(grade, segs);
}
/** 段间渐变秒数（0 即硬切，删键）。 */
export function setMontageCrossfade(grade: MontageGrade | undefined, sec: number): MontageGrade | undefined {
  const next: MontageGrade = { ...(grade ?? {}) };
  if (sec > 0) next.crossfadeSec = tenth(sec);
  else delete next.crossfadeSec;
  return Object.keys(next).length ? next : undefined;
}
export function setMontageAutoMatch(grade: MontageGrade | undefined, on: boolean): MontageGrade | undefined {
  const next: MontageGrade = { ...(grade ?? {}) };
  if (on) next.autoMatchJunctions = true;
  else delete next.autoMatchJunctions;
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
  hasSubtitles: boolean,
  outputSec?: number
): { grade?: MontageGrade; transition?: { kind: "fade" | "dissolve" | "wipeleft"; durationSec: number } } {
  const out: ReturnType<typeof montageFinishParams> = {};
  const g = finish?.grade;
  if (g) {
    if (g.clips && g.clips.length !== cutCount) throw new Error(`逐段调色有${g.clips.length}项，本方案有${cutCount}个切点，请重新设置`);
    if (g.referenceClipIndex != null && g.referenceClipIndex >= cutCount) throw new Error("代表镜头不在本方案切点范围内，请重新设置");
    const all = stripNeutral(g.all);
    const clips = g.clips?.map(stripNeutral);
    let segments: MontageGradeSegment[] | undefined;
    if (g.segments?.length) {
      if (g.clips || g.referenceClipIndex != null) throw new Error("分段调色不能与逐段调色同时使用，请重新设置");
      if (outputSec === undefined) throw new Error("分段调色缺少成片时长，请重新设置");
      const problem = checkMontageSegments(g.segments, outputSec, g.crossfadeSec ?? 0);
      if (problem) throw new Error(`分段调色：${problem}`);
      segments = g.segments.map(({ startSec, endSec, ...c }) => ({ ...(stripNeutral(c) ?? {}), startSec, endSec }));
      // 全部段中性 → 等于不分段，不下发（连同渐变与接点修正）
      if (!segments.some(({ startSec: _s, endSec: _e, ...rest }) => Object.keys(rest).length)) segments = undefined;
    }
    const grade: MontageGrade = {
      ...(all ? { all } : {}),
      ...(clips?.some(Boolean) ? { clips } : {}),
      ...(segments ? { segments } : {}),
      ...(g.referenceClipIndex != null && cutCount > 1 ? { referenceClipIndex: g.referenceClipIndex } : {}),
    };
    if (grade.segments) {
      if (g.crossfadeSec) grade.crossfadeSec = g.crossfadeSec;
      if (g.autoMatchJunctions) grade.autoMatchJunctions = true;
    }
    if (grade.all || grade.clips || grade.segments) out.grade = grade;
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

/**
 * 后期任务结果里的接点检查：服务端 output.gradeSegmentCheck = { check, autoMatch?: { adjusted, check } }；
 * 有 autoMatch 时以复检为准，接点 j 的后段（span j+1）在 adjusted 里即「已自动修正」。读不到返回 null。
 */
export type MontageJunctionCheck = {
  pass: boolean;
  junctions: Array<{ atSec: number; delta: { YAVG: number; UAVG: number; VAVG: number; SATAVG: number }; pass: boolean; autoCorrected: boolean }>;
};
export function readMontageJunctionCheck(output: unknown): MontageJunctionCheck | null {
  const seg = isRecord(output) && isRecord(output.gradeSegmentCheck) ? output.gradeSegmentCheck : null;
  const auto = seg && isRecord(seg.autoMatch) && isRecord(seg.autoMatch.check) ? seg.autoMatch : null;
  const check = auto ? (auto.check as Record<string, unknown>) : seg && isRecord(seg.check) ? seg.check : null;
  const rows = check && Array.isArray(check.junctions) ? check.junctions : null;
  if (!check || !rows) return null;
  const adjusted = auto && Array.isArray(auto.adjusted) ? auto.adjusted : [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  const junctions = rows.filter(isRecord).map(r => {
    const d = isRecord(r.delta) ? r.delta : {};
    return {
      atSec: num(r.junctionSec),
      delta: { YAVG: num(d.YAVG), UAVG: num(d.UAVG), VAVG: num(d.VAVG), SATAVG: num(d.SATAVG) },
      pass: r.pass === true,
      autoCorrected: typeof r.index === "number" && adjusted.includes(r.index + 1),
    };
  });
  if (junctions.length !== rows.length || junctions.some(j => !Number.isFinite(j.atSec))) return null;
  return { pass: typeof check.pass === "boolean" ? check.pass : junctions.every(j => j.pass), junctions };
}

/** 外部（调色建议/顾问）给出的分段写入草稿：先取一位小数，再走同一套格式与片长校验；不通过抛错、不改草稿。 */
export function applyMontageSegmentsDraft(grade: MontageGrade | undefined, segments: unknown, outputSec: number): MontageGrade | undefined {
  if (!Array.isArray(segments)) throw new Error("分段调色格式错误");
  const rounded = segments.map(s => (isRecord(s) ? { ...s, ...(typeof s.startSec === "number" ? { startSec: tenth(s.startSec) } : {}), ...(typeof s.endSec === "number" ? { endSec: tenth(s.endSec) } : {}) } : s));
  const next = normalizeMontageGrade({ ...(grade ?? {}), segments: rounded });
  const problem = checkMontageSegments(next.segments ?? [], outputSec, next.crossfadeSec ?? 0);
  if (problem) throw new Error(`分段调色：${problem}`);
  return next;
}
