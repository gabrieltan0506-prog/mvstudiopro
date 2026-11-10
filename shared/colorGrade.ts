/**
 * 调色：校正参数 → ffmpeg 滤镜链、signalstats 统计解析、镜头匹配与一致性检查。
 *
 * 移植自 agentic-color-grader（https://github.com/perbhat/agentic-color-grader）
 *   MIT License, Copyright (c) 2026 Perbhat Kumar
 *   - buildFilterChain / parseSignalStats / computeZoneDistribution ← .pi/extensions/lib/ffmpeg.ts
 *   - deriveMatchingCorrections ← .pi/extensions/match-shots.ts
 *   - 一致性阈值（YAVG ±5、UAVG/VAVG ±3、SATAVG ±5）← .pi/skills/multi-clip-grade/SKILL.md
 * 本仓改动：去掉 custom_filter 逃生口；LUT 只收 lutId，由服务端白名单解析为路径后注入；
 * 参数加 Zod 边界；纯函数，无 fs / 子进程依赖，前端与顾问可直接引用。
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions: The above copyright notice and this
 * permission notice shall be included in all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
 */
import { z } from "zod";

// ─── Interfaces（上游 lib/ffmpeg.ts） ──────────────────────────────────────

export interface SignalStats {
  YMIN: number; YLOW: number; YAVG: number; YHIGH: number; YMAX: number;
  UMIN: number; UAVG: number; UMAX: number;
  VMIN: number; VAVG: number; VMAX: number;
  SATMIN: number; SATAVG: number; SATMAX: number;
  HUEMED: number; HUEAVG: number;
}

export interface ZoneDistribution { blacks: number; shadows: number; midtones: number; highlights: number; whites: number }

// ─── 参数契约（字段名与上游 CorrectionParams 一致，lut → lutId） ─────────────

export const COLOR_GRADE_LUT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/**
 * 预设 LUT：id 与 server/assets/luts/manifest.json 一致（测试对账）；按类别分组、组内固定顺序。
 * 强度以「轻/标准」两档预设区分（服务端不收单独强度值）。
 */
export const COLOR_GRADE_LUT_GROUPS: ReadonlyArray<{ label: string; presets: ReadonlyArray<{ id: string; label: string }> }> = [
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

/** 顾问提示用：20 个预设 id 与中文标签、色温方向（数值越低越暖），让自然语言落到合法参数。 */
export const COLOR_GRADE_ADVISOR_HELP =
  "调色grade={all?:校正,clips?:[每切点一项或null，数量须等于本方案切点数],referenceClipIndex?:代表镜头(从0起),autoMatch?:true时以代表镜头为准逐段匹配并复测(最多3轮，仅直接切换)}；预设lutId(轻/标准即强度)：" +
  COLOR_GRADE_LUT_GROUPS.map(g => `${g.label}[${g.presets.map(p => `${p.id}=${p.label}`).join("，")}]`).join("；") +
  "；exposure -0.95–3档(0中性)；contrast .2–3(1中性)；saturation 0–3(1中性)；color_temperature 1000–40000K(6500中性，数值越低越暖、越高越冷)；color_balance{shadows,midtones,highlights:{r,g,b -1–1}}；curves{master,r,g,b:\"0/0 .5/.45 1/1\"}；grade=null还原原片色彩。";

/** curves 点串：仅 "x/y x/y …"，0–1 小数，杜绝滤镜分隔符注入。 */
const CURVE_POINTS_RE = /^(?:0|1|0?\.\d{1,4}|1\.0{1,4})\/(?:0|1|0?\.\d{1,4}|1\.0{1,4})(?: (?:0|1|0?\.\d{1,4}|1\.0{1,4})\/(?:0|1|0?\.\d{1,4}|1\.0{1,4})){1,15}$/;
const balanceSchema = z.object({
  r: z.number().finite().min(-1).max(1),
  g: z.number().finite().min(-1).max(1),
  b: z.number().finite().min(-1).max(1),
}).strict();
const curveSchema = z.string().trim().regex(CURVE_POINTS_RE, "曲线点格式不正确");
const gammaSchema = z.number().finite().min(0.1).max(10);

export const colorCorrectionSchema = z.object({
  /** server/assets/luts/manifest.json 中登记的 LUT id；不收路径。 */
  lutId: z.string().trim().regex(COLOR_GRADE_LUT_ID_RE, "调色预设编号不正确").optional(),
  /** 档位（stops）；上游 curves 写法要求 > -1。 */
  exposure: z.number().finite().min(-0.95).max(3).optional(),
  contrast: z.number().finite().min(0.2).max(3).optional(),
  gamma: gammaSchema.optional(),
  gamma_r: gammaSchema.optional(),
  gamma_g: gammaSchema.optional(),
  gamma_b: gammaSchema.optional(),
  saturation: z.number().finite().min(0).max(3).optional(),
  color_temperature: z.number().finite().min(1000).max(40000).optional(),
  color_balance: z.object({
    shadows: balanceSchema.optional(),
    midtones: balanceSchema.optional(),
    highlights: balanceSchema.optional(),
  }).strict().optional(),
  curves: z.object({
    master: curveSchema.optional(),
    r: curveSchema.optional(),
    g: curveSchema.optional(),
    b: curveSchema.optional(),
  }).strict().optional(),
}).strict();

export type ColorCorrection = z.infer<typeof colorCorrectionSchema>;

const tenthSecSchema = z.number().finite().min(0).max(3600)
  .refine(v => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6, "分段时间须为一位小数");

/** 一个调色时间段：以成片输出时间计（秒，一位小数），其余字段同 ColorCorrection。 */
export const gradeSegmentSchema = colorCorrectionSchema.extend({
  startSec: tenthSecSchema,
  endSec: tenthSecSchema,
  /** 从上一段渐变进本段的时长（0–2 秒）；缺省取 grade.crossfadeSec，再缺省 0 硬切。首段忽略。 */
  crossfadeSec: z.number().finite().min(0).max(2).optional(),
  /**
   * 进本段那个接点的意图：intended = 剧情意图的转变（如耳光变冷、结尾转亮），不修；
   * unwanted = 不该有的跳色（同镜头内或同场景素材拼接），autoMatchJunctions 只修这类。缺省 = 未提供意图，不修。
   */
  junctionIntent: z.enum(["intended", "unwanted"]).optional(),
}).strict();
export type GradeSegment = z.infer<typeof gradeSegmentSchema>;
export type JunctionIntent = NonNullable<GradeSegment["junctionIntent"]>;

export const gradeSegmentsFieldsSchema = {
  /** 按成片时间分段调色；连续不重叠。未覆盖的片头/片尾只吃 all（若有）。 */
  segments: z.array(gradeSegmentSchema).min(1).max(24).optional(),
  /** 段间调色渐变时长（0–2 秒，默认 0 硬切）。 */
  crossfadeSec: z.number().finite().min(0).max(2).optional(),
  /** 接点未达标时只对标 unwanted 的接点做限步长局部修正并重渲，按上一轮实测差值迭代到达标或 JUNCTION_FIX_MAX_ROUNDS 轮；仍未达标的进 warnings。 */
  autoMatchJunctions: z.boolean().optional(),
};

/**
 * 拼接调色参数：`all` 全片统一；`clips[i]` 逐镜头（浅合并覆盖 all，同上游 match_shots 的
 * `{ ...existingCorrections }` 叠加方式）；`referenceClipIndex` 指代表镜头，给出时合成后跑一致性检查。
 */
export const concatGradeSchema = z.object({
  all: colorCorrectionSchema.optional(),
  clips: z.array(colorCorrectionSchema.nullable()).min(1).max(12).optional(),
  referenceClipIndex: z.number().int().min(0).max(11).optional(),
  /** 以代表镜头为准自动匹配：应用→复测→再匹配，最多 GRADE_MATCH_MAX_ROUNDS 轮直到一致性达标。 */
  autoMatch: z.boolean().optional(),
  ...gradeSegmentsFieldsSchema,
}).strict().refine(g => !g.autoMatch || g.referenceClipIndex != null, { message: "自动匹配须指定代表镜头", path: ["autoMatch"] });
export type ConcatGrade = z.infer<typeof concatGradeSchema>;

/** 某段实际生效的校正参数；无任何参数时返回 null（滤镜不变）。 */
export function resolveClipCorrection(grade: ConcatGrade | undefined, index: number): ColorCorrection | null {
  if (!grade) return null;
  const merged: ColorCorrection = { ...(grade.all ?? {}), ...(grade.clips?.[index] ?? {}) };
  return Object.keys(merged).length ? merged : null;
}

/** 本次调色引用到的全部 lutId（去重），供服务端白名单校验。 */
export function collectGradeLutIds(grade: ConcatGrade | undefined): string[] {
  if (!grade) return [];
  const ids = [grade.all?.lutId, ...(grade.clips ?? []).map(c => c?.lutId), ...(grade.segments ?? []).map(c => c.lutId)].filter((v): v is string => !!v);
  return Array.from(new Set(ids));
}

// ─── Filter chain builder（上游 lib/ffmpeg.ts buildFilterChain，照搬顺序与公式） ──

/** @param resolveLut 由服务端按白名单把 lutId 解析为绝对 .cube 路径。 */
export function buildFilterChain(corrections: ColorCorrection, resolveLut?: (lutId: string) => string): string {
  const filters: string[] = [];

  // 1. LUT (first — converts log to linear/rec709 space)
  if (corrections.lutId) {
    if (!resolveLut) throw new Error("调色预设暂不可用");
    filters.push(`lut3d='${resolveLut(corrections.lutId)}'`);
  }

  // 2. Exposure / gamma (basic tonal)
  if (corrections.exposure !== undefined) {
    const factor = Math.pow(2, corrections.exposure);
    filters.push(`curves=master='0/0 ${0.5 / factor}/${0.5} 1/1'`);
  }
  if (corrections.gamma !== undefined) {
    filters.push(`eq=gamma=${corrections.gamma}`);
  }
  if (corrections.gamma_r !== undefined || corrections.gamma_g !== undefined || corrections.gamma_b !== undefined) {
    const r = corrections.gamma_r ?? 1;
    const g = corrections.gamma_g ?? 1;
    const b = corrections.gamma_b ?? 1;
    filters.push(`lutyuv=y=gammaval(${1 / ((r + g + b) / 3)})`);
    // Per-channel gamma via colorchannelmixer approach
    if (r !== 1 || g !== 1 || b !== 1) {
      filters.push(`colorbalance=rs=${r - 1}:gs=${g - 1}:bs=${b - 1}:rm=${r - 1}:gm=${g - 1}:bm=${b - 1}:rh=${r - 1}:gh=${g - 1}:bh=${b - 1}`);
    }
  }

  // 3. Contrast
  if (corrections.contrast !== undefined) {
    filters.push(`eq=contrast=${corrections.contrast}`);
  }

  // 4. Color temperature
  if (corrections.color_temperature !== undefined) {
    filters.push(`colortemperature=temperature=${corrections.color_temperature}`);
  }

  // 5. Color balance (shadows / midtones / highlights)
  if (corrections.color_balance) {
    const cb = corrections.color_balance;
    const parts: string[] = [];
    if (cb.shadows) parts.push(`rs=${cb.shadows.r}:gs=${cb.shadows.g}:bs=${cb.shadows.b}`);
    if (cb.midtones) parts.push(`rm=${cb.midtones.r}:gm=${cb.midtones.g}:bm=${cb.midtones.b}`);
    if (cb.highlights) parts.push(`rh=${cb.highlights.r}:gh=${cb.highlights.g}:bh=${cb.highlights.b}`);
    if (parts.length > 0) filters.push(`colorbalance=${parts.join(":")}`);
  }

  // 6. Curves
  if (corrections.curves) {
    const curveParts: string[] = [];
    if (corrections.curves.master) curveParts.push(`master='${corrections.curves.master}'`);
    if (corrections.curves.r) curveParts.push(`red='${corrections.curves.r}'`);
    if (corrections.curves.g) curveParts.push(`green='${corrections.curves.g}'`);
    if (corrections.curves.b) curveParts.push(`blue='${corrections.curves.b}'`);
    if (curveParts.length > 0) filters.push(`curves=${curveParts.join(":")}`);
  }

  // 7. Saturation
  if (corrections.saturation !== undefined) {
    filters.push(`eq=saturation=${corrections.saturation}`);
  }

  // 8. custom_filter：本仓不开放（任意滤镜串注入面）。
  return filters.join(",");
}

// ─── Signal stats parser（上游 lib/ffmpeg.ts parseSignalStats） ─────────────

export const SIGNALSTATS_PRINT_FILTER = "signalstats,metadata=mode=print";
/** 只测 seek 落点那一帧：滤镜图会预读数帧，parseSignalStats 取最后一次输出，接点检查须先截到 1 帧。 */
export const SIGNALSTATS_FIRST_FRAME_FILTER = `trim=end_frame=1,${SIGNALSTATS_PRINT_FILTER}`;

export function parseSignalStats(raw: string): SignalStats {
  const stats: Record<string, number> = {};
  const keyPattern = /lavfi\.signalstats\.([\w]+)=([\d.]+)/g;
  let match: RegExpExecArray | null;
  while ((match = keyPattern.exec(raw)) !== null) {
    stats[match[1]] = parseFloat(match[2]);
  }
  return {
    YMIN: stats["YMIN"] ?? 0, YLOW: stats["YLOW"] ?? 0, YAVG: stats["YAVG"] ?? 0, YHIGH: stats["YHIGH"] ?? 0, YMAX: stats["YMAX"] ?? 0,
    UMIN: stats["UMIN"] ?? 0, UAVG: stats["UAVG"] ?? 0, UMAX: stats["UMAX"] ?? 0,
    VMIN: stats["VMIN"] ?? 0, VAVG: stats["VAVG"] ?? 0, VMAX: stats["VMAX"] ?? 0,
    SATMIN: stats["SATMIN"] ?? 0, SATAVG: stats["SATAVG"] ?? 0, SATMAX: stats["SATMAX"] ?? 0,
    HUEMED: stats["HUEMED"] ?? 0, HUEAVG: stats["HUEAVG"] ?? 0,
  };
}

// ─── Zone distribution（上游 lib/ffmpeg.ts computeZoneDistribution） ───────

export function computeZoneDistribution(stats: SignalStats): ZoneDistribution {
  const range = stats.YMAX - stats.YMIN || 1;
  const low = ((stats.YLOW - stats.YMIN) / range) * 100;
  const mid = ((stats.YHIGH - stats.YLOW) / range) * 100;
  const high = ((stats.YMAX - stats.YHIGH) / range) * 100;
  return {
    blacks: Math.max(0, Math.min(100, stats.YMIN <= 16 ? 5 + (16 - stats.YMIN) : 2)),
    shadows: Math.max(0, Math.min(100, low * 0.4)),
    midtones: Math.max(0, Math.min(100, mid * 0.6)),
    highlights: Math.max(0, Math.min(100, high * 0.4)),
    whites: Math.max(0, Math.min(100, stats.YMAX >= 240 ? 5 + (stats.YMAX - 240) / 3 : 2)),
  };
}

// ─── 镜头匹配（上游 match-shots.ts deriveMatchingCorrections，照搬） ─────────

export type MatchAspect = "exposure" | "white_balance" | "saturation" | "all";

export function deriveMatchingCorrections(
  refStats: SignalStats,
  targetStats: SignalStats,
  aspects: MatchAspect[],
  existingCorrections: ColorCorrection,
): ColorCorrection {
  const corrections: ColorCorrection = { ...existingCorrections };
  const matchAll = aspects.includes("all");

  if (matchAll || aspects.includes("exposure")) {
    const yDelta = refStats.YAVG - targetStats.YAVG;
    if (Math.abs(yDelta) > 3) {
      const currentExposure = corrections.exposure ?? 0;
      const exposureAdjust = yDelta / 40;
      corrections.exposure = parseFloat((currentExposure + exposureAdjust).toFixed(3));
    }
  }

  if (matchAll || aspects.includes("white_balance")) {
    const uDelta = refStats.UAVG - targetStats.UAVG;
    const vDelta = refStats.VAVG - targetStats.VAVG;
    if (Math.abs(uDelta) > 2 || Math.abs(vDelta) > 2) {
      if (Math.abs(uDelta) > 2) {
        const currentTemp = corrections.color_temperature ?? 6500;
        const tempAdjust = uDelta * 60;
        corrections.color_temperature = Math.round(currentTemp + tempAdjust);
      }
      if (Math.abs(vDelta) > 2) {
        const vShift = vDelta / 255;
        corrections.color_balance = {
          ...corrections.color_balance,
          midtones: {
            r: parseFloat((vShift * 0.5).toFixed(3)),
            g: parseFloat((-vShift * 0.25).toFixed(3)),
            b: parseFloat((-vShift * 0.25).toFixed(3)),
          },
        };
      }
    }
  }

  if (matchAll || aspects.includes("saturation")) {
    const satDelta = refStats.SATAVG - targetStats.SATAVG;
    if (Math.abs(satDelta) > 3 && targetStats.SATAVG > 0) {
      const currentSat = corrections.saturation ?? 1.0;
      const satMultiplier = refStats.SATAVG / targetStats.SATAVG;
      const blended = 1.0 + (satMultiplier - 1.0) * 0.7;
      corrections.saturation = parseFloat((currentSat * blended).toFixed(3));
    }
  }

  return corrections;
}

/**
 * 色度比例控制（本仓偏离上游 white_balance 映射，仅用于 matchShotsToReference / 多轮匹配）。
 * 实测（ffmpeg 6.1 smptehdbars + signalstats）：上游 V→midtones 系数 vDelta/255*0.5 只有 midtones，
 * colorbalance 中间调权重窄，rm=0.1 仅让 VAVG +1，等于没修；U→color_temperature（uDelta*60 K）在 6500K 以上
 * 每千 K 只动约 5 个 U，且同时压亮度、带 V，三轮内偏暖片 U 残差仍约 7.5。
 * 改为：U 残差→中间调+高光 b、V 残差→中间调+高光 r，按「残差 / (增益 × 当前饱和度)」累加到已有 color_balance；
 * 实测 mid+high 同值 0.1 → 对应通道约 +6（增益 ≈ 60/单位），饱和度在 colorbalance 之后，会按倍数放大色度偏移。
 */
export const GRADE_CHROMA_GAIN = 60;
const clampBal = (v: number) => parseFloat(Math.min(1, Math.max(-1, v)).toFixed(3));

export function deriveChromaCorrection(refStats: SignalStats, targetStats: SignalStats, existing: ColorCorrection): ColorCorrection {
  const uDelta = refStats.UAVG - targetStats.UAVG;
  const vDelta = refStats.VAVG - targetStats.VAVG;
  if (Math.abs(uDelta) <= 2 && Math.abs(vDelta) <= 2) return { ...existing };
  const gain = GRADE_CHROMA_GAIN * Math.max(0.2, existing.saturation ?? 1);
  const db = Math.abs(uDelta) > 2 ? uDelta / gain : 0;
  const dr = Math.abs(vDelta) > 2 ? vDelta / gain : 0;
  const zero = { r: 0, g: 0, b: 0 };
  const shift = (t: { r: number; g: number; b: number } | undefined) => {
    const base = t ?? zero;
    return { r: clampBal(base.r + dr), g: base.g, b: clampBal(base.b + db) };
  };
  const cb = existing.color_balance;
  return { ...existing, color_balance: { ...cb, midtones: shift(cb?.midtones), highlights: shift(cb?.highlights) } };
}

/**
 * 按代表镜头批量算匹配参数（上游 multi-clip-grade 流程：先定 hero，再逐镜头 match_shots）。
 * 返回值可直接作为 `grade.clips`；代表镜头保持其原参数。结果再过一次 schema 收边界。
 * 偏离上游（均为多轮复测收敛所需）：
 *   1) 色度不用上游 色温/midtones 映射，改走 deriveChromaCorrection 比例控制、在上一轮参数上累加；
 *   2) 亮度与饱和度解耦：亮度超差的一轮只调曝光与色度，饱和度待亮度达标后再调——提亮本身会抬 SATAVG，
 *      同轮按旧亮度下的饱和度比例再乘会反超（暗片实测首轮 SATAVG 反超 +11~14）。
 * 曝光、饱和度公式仍照上游 deriveMatchingCorrections。
 */
export function matchShotsToReference(params: {
  stats: SignalStats[];
  referenceClipIndex: number;
  aspects?: MatchAspect[];
  existing?: Array<ColorCorrection | null | undefined>;
}): Array<ColorCorrection | null> {
  const { stats, referenceClipIndex } = params;
  const ref = stats[referenceClipIndex];
  if (!ref) throw new Error("代表镜头不存在");
  const aspects = params.aspects ?? ["all"];
  const want = (a: MatchAspect) => aspects.includes("all") || aspects.includes(a);
  return stats.map((s, i) => {
    const base = params.existing?.[i] ?? {};
    let next: ColorCorrection = { ...base };
    if (i !== referenceClipIndex) {
      const lumaOff = want("exposure") && Math.abs(ref.YAVG - s.YAVG) > GRADE_CONSISTENCY_TOLERANCE.YAVG;
      const tonal: MatchAspect[] = [];
      if (want("exposure")) tonal.push("exposure");
      if (want("saturation") && !lumaOff) tonal.push("saturation");
      if (tonal.length) next = deriveMatchingCorrections(ref, s, tonal, next);
      if (want("white_balance")) next = deriveChromaCorrection(ref, s, next);
    }
    if (next.exposure !== undefined) next.exposure = Math.min(3, Math.max(-0.95, next.exposure));
    if (next.color_temperature !== undefined) next.color_temperature = Math.min(40000, Math.max(1000, next.color_temperature));
    if (next.saturation !== undefined) next.saturation = Math.min(3, Math.max(0, next.saturation));
    const parsed = colorCorrectionSchema.parse(next);
    return Object.keys(parsed).length ? parsed : null;
  });
}

// ─── 一致性检查（上游 multi-clip-grade SKILL.md：YAVG ±5，UAVG/VAVG ±3，SATAVG ±5） ──

export const GRADE_CONSISTENCY_TOLERANCE = { YAVG: 5, UAVG: 3, VAVG: 3, SATAVG: 5 } as const;

export type GradeConsistencyReport = {
  pass: boolean;
  referenceClipIndex: number;
  clips: Array<{
    index: number;
    pass: boolean;
    delta: { YAVG: number; UAVG: number; VAVG: number; SATAVG: number };
  }>;
};

export function checkGradeConsistency(stats: SignalStats[], referenceClipIndex: number): GradeConsistencyReport {
  const ref = stats[referenceClipIndex];
  if (!ref) throw new Error("代表镜头不存在");
  const keys = Object.keys(GRADE_CONSISTENCY_TOLERANCE) as Array<keyof typeof GRADE_CONSISTENCY_TOLERANCE>;
  const clips = stats.map((s, index) => {
    const delta = Object.fromEntries(keys.map(k => [k, parseFloat((s[k] - ref[k]).toFixed(2))])) as GradeConsistencyReport["clips"][number]["delta"];
    return { index, pass: keys.every(k => Math.abs(delta[k]) <= GRADE_CONSISTENCY_TOLERANCE[k]), delta };
  });
  return { pass: clips.every(c => c.pass), referenceClipIndex, clips };
}

// ─── 多轮匹配（上游做法：match_shots 后复测，不达标再匹配） ──────────────────

export const GRADE_MATCH_MAX_ROUNDS = 3;

export type GradeMatchRound = {
  /** 0 = 初测（未匹配）；1..N = 第 N 轮匹配后的复测 */
  round: number;
  clips: Array<ColorCorrection | null>;
  report: GradeConsistencyReport;
};

/**
 * 应用→复测→再匹配：先按 existing 测一次，不达标则 matchShotsToReference（以本轮复测值、在本轮参数上叠加），
 * 再交 measure 应用并复测，最多 maxRounds 轮或 checkGradeConsistency 达标即停。
 * measure 负责真实应用滤镜并测 signalstats（含原始输出与解析 JSON 留档），按段一一对应返回。
 */
export async function matchShotsIteratively(params: {
  clipCount: number;
  referenceClipIndex: number;
  existing?: Array<ColorCorrection | null | undefined>;
  aspects?: MatchAspect[];
  maxRounds?: number;
  measure: (clips: Array<ColorCorrection | null>, round: number) => Promise<SignalStats[]>;
}): Promise<{ pass: boolean; clips: Array<ColorCorrection | null>; rounds: GradeMatchRound[] }> {
  const maxRounds = Math.min(GRADE_MATCH_MAX_ROUNDS, Math.max(0, params.maxRounds ?? GRADE_MATCH_MAX_ROUNDS));
  let clips: Array<ColorCorrection | null> = Array.from({ length: params.clipCount }, (_v, i) => {
    const c = params.existing?.[i];
    return c && Object.keys(c).length ? colorCorrectionSchema.parse(c) : null;
  });
  const rounds: GradeMatchRound[] = [];
  for (let round = 0; ; round++) {
    const stats = await params.measure(clips, round);
    if (stats.length !== params.clipCount) throw new Error("调色复测条数不一致");
    const report = checkGradeConsistency(stats, params.referenceClipIndex);
    rounds.push({ round, clips, report });
    if (report.pass || round >= maxRounds) return { pass: report.pass, clips, rounds };
    clips = matchShotsToReference({ stats, referenceClipIndex: params.referenceClipIndex, aspects: params.aspects, existing: clips });
  }
}

// ─── 按成片时间分段调色（segments）、段间 LUT 渐变、接点一致性 ─────────────────
//
// 实现方式：拼接（或转场）得到整条成片画面后，split 成 N 份，各份 trim 到自己的时间段并套本段滤镜，
// crossfadeSec=0 时 concat 硬切；>0 时每段向接点两侧各多取 crossfadeSec/2，用 xfade=fade 在
// 两组调色结果之间渐变，offset = 接点 - crossfadeSec/2，总时长不变、画面时间线与音轨不受影响。
// 没选 enable='between(t,a,b)'：lut3d 等滤镜的 timeline 支持不一，且 enable 做不了两组结果的渐变。

/** 分段字段的结构校验；返回错误句或 null。成片时长相关的校验在 planGradeSegments。 */
export function validateGradeSegments(grade: ConcatGrade | undefined): string | null {
  if (!grade) return null;
  const segs = grade.segments;
  if (!segs) return grade.crossfadeSec != null || grade.autoMatchJunctions != null ? "调色渐变与接点匹配须配合分段使用" : null;
  if (grade.clips || grade.referenceClipIndex != null) return "分段调色不能与逐段调色同时使用";
  for (let i = 0; i < segs.length; i++) {
    if (!(segs[i].endSec - segs[i].startSec >= 0.1 - 1e-6)) return "每个调色分段至少 0.1 秒";
    if (i > 0 && Math.abs(segs[i].startSec - segs[i - 1].endSec) > 1e-6) return "调色分段须首尾相接、不重叠";
  }
  return null;
}

export type GradeSpan = {
  startSec: number; endSec: number; correction: ColorCorrection | null;
  /** 从上一段渐变进本段的秒数 */ crossfadeSec?: number;
  /** 进本段那个接点的意图（来自 segments[].junctionIntent）；缺省 = 未提供 */ junctionIntent?: JunctionIntent;
  /** 自动修正插入的局部过渡子段：属于第几个接点（原 spans 下标 k 的接点 = span k → span k+1） */ rampOf?: number;
};

/** 把分段补全为覆盖 [0,totalSec] 的时间段（头尾空档只吃 all），并校验渐变时长与成片时长。 */
export function planGradeSegments(grade: ConcatGrade, totalSec: number): GradeSpan[] {
  const segs = grade.segments ?? [];
  const err = validateGradeSegments(grade);
  if (err) throw new Error(err);
  if (!segs.length) throw new Error("没有调色分段");
  const base = grade.all && Object.keys(grade.all).length ? grade.all : null;
  const pick = (s: GradeSegment): ColorCorrection | null => {
    const { startSec: _s, endSec: _e, crossfadeSec: _c, junctionIntent: _j, ...c } = s;
    const merged = { ...(grade.all ?? {}), ...c };
    return Object.keys(merged).length ? merged : null;
  };
  const end = segs[segs.length - 1].endSec;
  if (end > totalSec + 0.05) throw new Error("调色分段超出成片时长");
  const dflt = grade.crossfadeSec ?? 0;
  const spans: GradeSpan[] = [];
  if (segs[0].startSec > 0) spans.push({ startSec: 0, endSec: segs[0].startSec, correction: base });
  for (const s of segs) spans.push({ startSec: s.startSec, endSec: Math.min(s.endSec, totalSec), correction: pick(s), crossfadeSec: s.crossfadeSec ?? dflt, ...(s.junctionIntent ? { junctionIntent: s.junctionIntent } : {}) });
  if (totalSec - end >= 0.05) spans.push({ startSec: end, endSec: totalSec, correction: base, crossfadeSec: dflt });
  spans[0].crossfadeSec = 0;
  delete spans[0].junctionIntent;
  spans.forEach((s, k) => { if (!s.crossfadeSec) delete s.crossfadeSec; });
  // 相邻两个渐变窗不得重叠：本段长 ≥ (进本段渐变 + 出本段渐变) / 2
  const cf = (k: number) => spans[k]?.crossfadeSec ?? 0;
  if (spans.some((s, k) => s.endSec - s.startSec < (cf(k) + cf(k + 1)) / 2 - 1e-6 || (k > 0 && s.endSec - s.startSec < cf(k) - 1e-6)))
    throw new Error("调色分段须长于渐变时长");
  return spans;
}

const sec = (v: number) => parseFloat(v.toFixed(3)).toString();

/**
 * 在 `[inLabel]` 整条画面上按时间段调色，输出 `[outLabel]`。spans 须覆盖整条成片（planGradeSegments 产出）。
 * crossfadeSec > 0 时段间用 xfade=fade 在两组调色结果之间渐变，总时长不变。
 */
export function buildSegmentGradeGraph(
  inLabel: string,
  outLabel: string,
  spans: Array<{ startSec: number; endSec: number; filter: string; crossfadeSec?: number }>,
  crossfadeSec = 0,
): string {
  const n = spans.length;
  if (n < 1) throw new Error("没有调色分段");
  /** 第 k 个接点（span k-1 → span k）的渐变秒数；段上未写则用默认 crossfadeSec。 */
  const cf = (k: number) => (k <= 0 || k >= n ? 0 : spans[k].crossfadeSec ?? crossfadeSec);
  const parts: string[] = [`[${inLabel}]split=${n}${spans.map((_s, i) => `[gs${i}]`).join("")}`];
  spans.forEach((s, i) => {
    const from = i === 0 ? 0 : Math.max(0, s.startSec - cf(i) / 2);
    const trim = [from > 0 ? `start=${sec(from)}` : "", i === n - 1 ? "" : `end=${sec(s.endSec + cf(i + 1) / 2)}`].filter(Boolean).join(":");
    parts.push(`[gs${i}]${trim ? `trim=${trim},` : ""}setpts=PTS-STARTPTS,${s.filter ? `${s.filter},` : ""}format=yuv420p[gg${i}]`);
  });
  if (n === 1) return `${parts.join(";")};[gg0]null[${outLabel}]`;
  if (spans.every((_s, k) => cf(k) <= 0)) return `${parts.join(";")};${spans.map((_s, i) => `[gg${i}]`).join("")}concat=n=${n}:v=1:a=0[${outLabel}]`;
  let prev = "gg0";
  // concat 输出时基为 AVTB，后续 xfade 要求两路时基一致（否则 ffmpeg 报 timebase do not match 直接失败）：
  // 链上一旦出现过硬切，其后的 xfade 两路先 settb=AVTB。没有「硬切后接渐变」的图逐字不变。
  let afterConcat = false;
  for (let k = 1; k < n; k++) {
    const label = k === n - 1 ? outLabel : `gx${k}`;
    const c = cf(k);
    if (c > 0 && afterConcat) {
      parts.push(`[${prev}]settb=AVTB[gt${k}a]`, `[gg${k}]settb=AVTB[gt${k}b]`,
        `[gt${k}a][gt${k}b]xfade=transition=fade:duration=${sec(c)}:offset=${sec(spans[k - 1].endSec - c / 2)}[${label}]`);
    } else {
      parts.push(c > 0
        ? `[${prev}][gg${k}]xfade=transition=fade:duration=${sec(c)}:offset=${sec(spans[k - 1].endSec - c / 2)}[${label}]`
        : `[${prev}][gg${k}]concat=n=2:v=1:a=0[${label}]`);
    }
    if (c <= 0) afterConcat = true;
    prev = label;
  }
  return parts.join(";");
}

/** 接点检查取帧位置：每个接点前后各 0.1 秒（夹在成片范围内）。 */
export const JUNCTION_SAMPLE_OFFSET_SEC = 0.1;
export function junctionSampleTimes(spans: Array<{ startSec: number; endSec: number }>): Array<{ index: number; junctionSec: number; beforeSec: number; afterSec: number }> {
  const total = spans[spans.length - 1]?.endSec ?? 0;
  return spans.slice(0, -1).map((s, index) => ({
    index,
    junctionSec: s.endSec,
    beforeSec: parseFloat(Math.max(0, s.endSec - JUNCTION_SAMPLE_OFFSET_SEC).toFixed(3)),
    afterSec: parseFloat(Math.min(Math.max(0, total - 0.04), s.endSec + JUNCTION_SAMPLE_OFFSET_SEC).toFixed(3)),
  }));
}

export type JunctionConsistencyReport = {
  pass: boolean;
  junctions: Array<{ index: number; junctionSec: number; pass: boolean; delta: { YAVG: number; UAVG: number; VAVG: number; SATAVG: number } }>;
};

/** 接点一致性：后帧 − 前帧，阈值同 checkGradeConsistency。 */
export function checkJunctionConsistency(pairs: Array<{ index: number; junctionSec: number; before: SignalStats; after: SignalStats }>): JunctionConsistencyReport {
  const junctions = pairs.map(p => {
    const r = checkGradeConsistency([p.before, p.after], 0).clips[1];
    return { index: p.index, junctionSec: p.junctionSec, pass: r.pass, delta: r.delta };
  });
  return { pass: junctions.every(j => j.pass), junctions };
}

/**
 * 接点段均值取样：接点前、后各取一小段（默认各 0.5 秒内均匀 5 帧，取帧中心点），每帧仍用 SIGNALSTATS_FIRST_FRAME_FILTER 单帧截取。
 * 前窗止于本接点渐变窗左沿（接点 − 渐变/2），后窗起于右沿（接点 + 渐变/2）——比较两侧调色完全生效后的样子；
 * 不跨越渐变窗外的镜头切换（cutsSec，如素材拼接点）、相邻接点的渐变窗、片头与片尾。
 */
export const JUNCTION_WINDOW_SEC = 0.5;
export const JUNCTION_WINDOW_FRAMES = 5;
export type JunctionSampleWindow = {
  index: number; junctionSec: number; crossfadeSec: number;
  before: { fromSec: number; toSec: number; times: number[] };
  after: { fromSec: number; toSec: number; times: number[] };
};
export function junctionSampleWindows(
  spans: Array<{ startSec: number; endSec: number; crossfadeSec?: number }>,
  opts: { cutsSec?: number[]; windowSec?: number; frames?: number } = {},
): JunctionSampleWindow[] {
  const n = spans.length;
  const total = spans[n - 1]?.endSec ?? 0;
  const w = opts.windowSec ?? JUNCTION_WINDOW_SEC, f = Math.max(1, Math.round(opts.frames ?? JUNCTION_WINDOW_FRAMES));
  const cuts = opts.cutsSec ?? [];
  const cf = (k: number) => (k <= 0 || k >= n ? 0 : spans[k].crossfadeSec ?? 0);
  const r3 = (v: number) => parseFloat(v.toFixed(3));
  const spread = (a: number, b: number) => (b - a < 1e-3 ? [r3(Math.max(0, b - 0.02))] : Array.from({ length: f }, (_v, i) => r3(a + ((i + 0.5) * (b - a)) / f)));
  return spans.slice(0, -1).map((s, index) => {
    const J = s.endSec, c = cf(index + 1);
    const fadeL = J - c / 2, fadeR = J + c / 2;
    let lo = Math.max(0, fadeL - w, s.startSec + cf(index) / 2);
    for (const cut of cuts) if (cut < fadeL - 1e-6 && cut > lo) lo = cut;
    let hi = Math.min(Math.max(fadeR, total - 0.04), fadeR + w, spans[index + 1].endSec - cf(index + 2) / 2);
    for (const cut of cuts) if (cut > fadeR + 1e-6 && cut < hi) hi = cut;
    return {
      index, junctionSec: J, crossfadeSec: c,
      before: { fromSec: r3(lo), toSec: r3(fadeL), times: spread(lo, fadeL) },
      after: { fromSec: r3(fadeR), toSec: r3(hi), times: spread(fadeR, hi) },
    };
  });
}

/** 多帧 signalstats 逐项取均值（3 位小数）。 */
export function meanSignalStats(list: SignalStats[]): SignalStats {
  if (!list.length) throw new Error("没有可平均的取样帧");
  const out = {} as Record<keyof SignalStats, number>;
  for (const k of Object.keys(list[0]) as Array<keyof SignalStats>) out[k] = parseFloat((list.reduce((a, s) => a + s[k], 0) / list.length).toFixed(3));
  return out;
}

/** 单次自动修正的步长上限：曝光 ±0.25 档、饱和度 ±0.15、color_balance 每通道 ±0.05；局部过渡 1.0 秒。 */
export const JUNCTION_FIX_LIMITS = { exposure: 0.25, saturation: 0.15, balance: 0.05, rampSec: 1.0, minRampSec: 0.2 } as const;

export type JunctionFixNote = {
  index: number; junctionSec: number; intent: JunctionIntent | null;
  action: "pass" | "fixed" | "intended" | "no_intent" | "too_short" | "no_step";
  noteZh: string;
  /** 该接点累计已下发的修正轮数（含本轮）；未修过不带 */ rounds?: number;
  /** 实际叠加到后段起点的增量（已限步长） */ step?: { exposure?: number; saturation?: number; color_balance?: ColorCorrection["color_balance"] };
  /** 修正值从 rampFromSec（后段渐变结束）起线性回到原值，至 rampToSec 完全回原值 */ rampFromSec?: number; rampToSec?: number;
};

/**
 * 接点自动修正（只修 unwanted、限步长、只动接点附近）：
 * - 接点意图取后段 junctionIntent：intended 不修；缺省视为未提供意图，不修（保守）；达标的不修。
 * - unwanted 且未达标：以接点前窗均值为参照，用 matchShotsToReference 算后段全量修正，与原参数的差逐项限步长
 *   （JUNCTION_FIX_LIMITS），得到 B' = 原参数 + 限幅增量。
 * - 不改整段基调：把后段 [J, end] 拆成过渡子段 [J, M]（参数 B'）与余段 [M, end]（原参数 B，逐字不变），
 *   两者之间用现有段间 xfade=fade 渐变 d 秒，d = min(1.0, 到下一接点渐变窗) ，M = J + c/2 + d/2：
 *   画面在 [J−c/2, J+c/2] 从前段渐变到 B'，在 [J+c/2, J+c/2+d] 从 B' 线性（像素域线性混合）回到 B。
 * 每次只算一轮。多轮（matchJunctionsIteratively）时传入上一轮返回的 state，spans / 取样位置始终用原始分段：
 * - 本轮增量叠在上一轮已下发的 B' 上（过渡子段位置不变，余段仍回到原参数 B）；已达标的接点保留已有修正、不再加步。
 * - 防过冲：按上一轮「下发了公式全量的几成（φ）→ 实测消掉了差值的几成（ρ）」把公式增量乘 k = φ/ρ（夹在 0.25–2），
 *   修过头（差值变号，ρ>1）自动缩步，修不动（ρ≤0.05）保持；每轮增量仍逐项限 JUNCTION_FIX_LIMITS。
 * adjusted 为累计被修正接点的后段在原 spans 中的下标；stepped 为本轮新下发了增量的后段下标（空 = 无需/无法再修）。
 */
export type JunctionFixAxis = "exposure" | "saturation" | "balance";
type JunctionAxisTrack = { /** 公式全量增量（未缩放未限幅） */ raw: number; /** 实际下发增量 */ applied: number; /** 下发前该项实测差 */ delta: number; key: keyof typeof GRADE_CONSISTENCY_TOLERANCE };
export type JunctionFixState = Map<number, {
  corr: ColorCorrection; M: number; d: number; rounds: number;
  k: Record<JunctionFixAxis, number>;
  last: Partial<Record<JunctionFixAxis, JunctionAxisTrack>>;
}>;
export const JUNCTION_FIX_GAIN_RANGE = { min: 0.25, max: 2 } as const;

export function applyJunctionAutoMatch(
  spans: GradeSpan[],
  pairs: Array<{ index: number; before: SignalStats; after: SignalStats }>,
  report: JunctionConsistencyReport,
  prev?: JunctionFixState,
): { spans: GradeSpan[]; adjusted: number[]; stepped: number[]; junctions: JunctionFixNote[]; state: JunctionFixState } {
  const L = JUNCTION_FIX_LIMITS;
  const clampD = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
  const r3 = (v: number) => parseFloat(v.toFixed(3));
  const cfOf = (k: number) => (k <= 0 || k >= spans.length ? 0 : spans[k].crossfadeSec ?? 0);
  const fixes: JunctionFixState = new Map(prev ?? []);
  const stepped: number[] = [];
  const junctions: JunctionFixNote[] = [];
  for (const j of report.junctions) {
    const target = j.index + 1;
    const after = spans[target];
    const intent = after?.junctionIntent ?? null;
    const note = (action: JunctionFixNote["action"], noteZh: string, extra: Partial<JunctionFixNote> = {}) =>
      junctions.push({ index: j.index, junctionSec: j.junctionSec, intent, action, noteZh, ...extra });
    const had = fixes.get(target);
    if (j.pass) {
      if (had) note("fixed", `已修正 ${had.rounds} 轮，接点达标`, { rounds: had.rounds, rampFromSec: r3(had.M - had.d / 2), rampToSec: r3(had.M + had.d / 2) });
      else note("pass", "接点达标，未修正");
      continue;
    }
    if (intent === "intended") { note("intended", "剧情意图的转变，未修正"); continue; }
    if (intent !== "unwanted") { note("no_intent", "未提供意图，未修正"); continue; }
    const p = pairs.find(x => x.index === j.index);
    if (!p || !after) { note("no_step", "缺少接点取样，未修正"); continue; }
    const c = cfOf(target);
    const rampFrom = after.startSec + c / 2;
    const rampTo = Math.min(rampFrom + L.rampSec, after.endSec - cfOf(target + 1) / 2);
    const d = rampTo - rampFrom;
    if (d < L.minRampSec - 1e-6) { note("too_short", "后段过短，放不下局部过渡，未修正"); continue; }
    // B = 上一轮已下发的修正（首轮 = 后段原参数）；本轮增量叠在它上面。
    const B: ColorCorrection = had?.corr ?? after.correction ?? {};
    // 增益校准：上一轮下发了公式全量的 φ、实测消掉差值的 ρ → 本轮公式增量乘 φ/ρ。
    const k = { exposure: 1, saturation: 1, balance: 1, ...had?.k };
    for (const axis of ["exposure", "saturation", "balance"] as const) {
      const t = had?.last[axis];
      if (!t || Math.abs(t.raw) < 1e-6 || Math.abs(t.delta) < 1e-6) continue;
      const rho = (t.delta - j.delta[t.key]) / t.delta;
      if (rho > 0.05) k[axis] = Math.min(JUNCTION_FIX_GAIN_RANGE.max, Math.max(JUNCTION_FIX_GAIN_RANGE.min, (t.applied / t.raw) / rho));
    }
    const [, full] = matchShotsToReference({ stats: [p.before, p.after], referenceClipIndex: 0, existing: [null, B] });
    const F: ColorCorrection = full ?? {};
    const next: ColorCorrection = structuredClone(B);
    const step: NonNullable<JunctionFixNote["step"]> = {};
    const last: Partial<Record<JunctionFixAxis, JunctionAxisTrack>> = {};
    const rawE = (F.exposure ?? 0) - (B.exposure ?? 0);
    const dE = r3(clampD(rawE * k.exposure, L.exposure));
    if (Math.abs(dE) >= 0.005) { next.exposure = r3(Math.min(3, Math.max(-0.95, (B.exposure ?? 0) + dE))); step.exposure = dE; last.exposure = { raw: rawE, applied: dE, delta: j.delta.YAVG, key: "YAVG" }; }
    const rawS = (F.saturation ?? 1) - (B.saturation ?? 1);
    const dS = r3(clampD(rawS * k.saturation, L.saturation));
    if (Math.abs(dS) >= 0.005) { next.saturation = r3(Math.min(3, Math.max(0, (B.saturation ?? 1) + dS))); step.saturation = dS; last.saturation = { raw: rawS, applied: dS, delta: j.delta.SATAVG, key: "SATAVG" }; }
    let rawBal = 0, appliedBal = 0;
    for (const zone of ["shadows", "midtones", "highlights"] as const) {
      const fb = F.color_balance?.[zone], bb = B.color_balance?.[zone];
      if (!fb) continue;
      const base = bb ?? { r: 0, g: 0, b: 0 };
      const raw = { r: fb.r - base.r, g: fb.g - base.g, b: fb.b - base.b };
      const dz = { r: r3(clampD(raw.r * k.balance, L.balance)), g: r3(clampD(raw.g * k.balance, L.balance)), b: r3(clampD(raw.b * k.balance, L.balance)) };
      if (Math.abs(dz.r) < 0.001 && Math.abs(dz.g) < 0.001 && Math.abs(dz.b) < 0.001) continue;
      for (const ch of ["r", "g", "b"] as const) if (Math.abs(raw[ch]) > Math.abs(rawBal)) { rawBal = raw[ch]; appliedBal = dz[ch]; }
      next.color_balance = { ...next.color_balance, [zone]: { r: clampBal(base.r + dz.r), g: clampBal(base.g + dz.g), b: clampBal(base.b + dz.b) } };
      step.color_balance = { ...step.color_balance, [zone]: dz };
    }
    if (step.color_balance) {
      const key = Math.abs(j.delta.UAVG) >= Math.abs(j.delta.VAVG) ? "UAVG" : "VAVG";
      last.balance = { raw: rawBal, applied: appliedBal, delta: j.delta[key], key };
    }
    if (!Object.keys(step).length) { note("no_step", had ? `已修正 ${had.rounds} 轮，匹配增量为零，无法继续修正` : "匹配增量为零，未修正", had ? { rounds: had.rounds } : {}); continue; }
    const rounds = (had?.rounds ?? 0) + 1;
    fixes.set(target, { corr: colorCorrectionSchema.parse(next), M: r3(rampFrom + d / 2), d: r3(d), rounds, k, last });
    stepped.push(target);
    const parts = [step.exposure != null ? `曝光 ${step.exposure > 0 ? "+" : ""}${step.exposure} 档` : "", step.saturation != null ? `饱和 ${step.saturation > 0 ? "+" : ""}${step.saturation}` : "", step.color_balance ? "色彩平衡微调" : ""].filter(Boolean);
    note("fixed", `${rounds > 1 ? `第 ${rounds} 轮` : ""}局部修正：${parts.join("、")}，${r3(rampFrom)}–${r3(rampTo)} 秒线性回到原值`, { step, rounds, rampFromSec: r3(rampFrom), rampToSec: r3(rampTo) });
  }
  const out: GradeSpan[] = [];
  spans.forEach((s, i) => {
    const fx = fixes.get(i);
    if (!fx) { out.push({ ...s }); return; }
    out.push({ ...s, endSec: fx.M, correction: fx.corr, rampOf: i - 1 });
    const { junctionIntent: _j, ...rest } = s;
    out.push({ ...rest, startSec: fx.M, crossfadeSec: fx.d, rampOf: i - 1 });
  });
  return { spans: out, adjusted: Array.from(fixes.keys()).sort((x, y) => x - y), stepped, junctions, state: fixes };
}

// ─── 接点多轮修正与未达标警告 ─────────────────────────────────────────────

/** 接点自动修正的重渲轮数上限（每轮 = 整片重渲 + 原接点位置复检）。 */
export const JUNCTION_FIX_MAX_ROUNDS = 3;

const JUNCTION_METRIC_ZH = { YAVG: "亮度", UAVG: "蓝色", VAVG: "红色", SATAVG: "饱和" } as const;

/**
 * 交付时仍未达标的 unwanted 接点（结构化，供前端显示；文案不含技术名词）。
 * reason：max_rounds = 修满上限仍超差；too_short = 后段过短放不下局部过渡；no_step = 已无可用修正量；
 * not_attempted = 未开启自动修正（或该渲染路径不支持）。intended / 未提供意图的接点不进警告。
 */
export type JunctionWarning = {
  index: number;
  /** 接点秒位（成片时间） */ atSec: number;
  intent: "unwanted";
  /** 已下发的修正轮数 */ rounds: number;
  maxRounds: number;
  reason: "max_rounds" | "too_short" | "no_step" | "not_attempted";
  /** 超差项：后 − 前的实测差、容差、超出量 */
  failing: Array<{ key: keyof typeof GRADE_CONSISTENCY_TOLERANCE; labelZh: string; delta: number; tolerance: number; overBy: number }>;
  delta: { YAVG: number; UAVG: number; VAVG: number; SATAVG: number };
  messageZh: string;
};

export function buildJunctionWarnings(
  spans: GradeSpan[],
  report: JunctionConsistencyReport,
  opts: { state?: JunctionFixState; notes?: JunctionFixNote[]; attempted?: boolean; maxRounds?: number } = {},
): JunctionWarning[] {
  const maxRounds = opts.maxRounds ?? JUNCTION_FIX_MAX_ROUNDS;
  const keys = Object.keys(GRADE_CONSISTENCY_TOLERANCE) as Array<keyof typeof GRADE_CONSISTENCY_TOLERANCE>;
  const signed = (v: number) => `${v > 0 ? "+" : ""}${v}`;
  return report.junctions.flatMap(j => {
    if (j.pass || spans[j.index + 1]?.junctionIntent !== "unwanted") return [];
    const rounds = opts.state?.get(j.index + 1)?.rounds ?? 0;
    const noteAction = opts.notes?.find(n => n.index === j.index)?.action;
    const reason: JunctionWarning["reason"] = !opts.attempted ? "not_attempted"
      : noteAction === "too_short" ? "too_short"
      : rounds >= maxRounds ? "max_rounds"
      : "no_step";
    const failing = keys.filter(k => Math.abs(j.delta[k]) > GRADE_CONSISTENCY_TOLERANCE[k]).map(k => ({
      key: k, labelZh: JUNCTION_METRIC_ZH[k], delta: j.delta[k], tolerance: GRADE_CONSISTENCY_TOLERANCE[k],
      overBy: parseFloat((Math.abs(j.delta[k]) - GRADE_CONSISTENCY_TOLERANCE[k]).toFixed(2)),
    }));
    const tail = reason === "not_attempted" ? "未做自动修正"
      : reason === "too_short" ? "后段过短放不下局部过渡，未能修正"
      : reason === "max_rounds" ? `已自动修正 ${rounds} 轮仍未压住`
      : rounds ? `已自动修正 ${rounds} 轮，无法继续修正` : "无可用修正量，未能修正";
    const messageZh = `${j.junctionSec.toFixed(1)} 秒接点仍有跳变：${failing.map(f => `${f.labelZh}差 ${signed(f.delta)}（允许 ±${f.tolerance}）`).join("、")}，${tail}`;
    return [{ index: j.index, atSec: j.junctionSec, intent: "unwanted" as const, rounds, maxRounds, reason, failing, delta: j.delta, messageZh }];
  });
}

type JunctionMeasured = JunctionConsistencyReport & { pairs: Array<{ index: number; junctionSec: number; before: SignalStats; after: SignalStats }> };

/**
 * 接点多轮修正：对标 unwanted 且未达标的接点，修正 → 重渲复检（render，按原接点位置取样）→ 用本轮实测差继续修，
 * 直到 unwanted 接点全部达标、没有可再下发的增量，或满 maxRounds 轮。intended / 未提供意图的接点始终不动。
 * 防越修越差：最后一轮若不是各轮（含首检）里最好的一版，按最好那版额外回退重渲一次（revertedToRound）。
 * 返回最后一次实际渲染的 spans 与复检（一轮都没渲染时 check 缺省、spans 为原分段），以及仍未达标的结构化警告。
 */
export async function matchJunctionsIteratively<C extends JunctionMeasured>(params: {
  spans: GradeSpan[];
  first: C;
  maxRounds?: number;
  render: (spans: GradeSpan[], round: number) => Promise<C>;
}): Promise<{
  adjusted: number[]; spans: GradeSpan[]; junctions: JunctionFixNote[]; check?: C;
  rounds: Array<{ round: number; spans: GradeSpan[]; junctions: JunctionFixNote[]; check: C }>;
  maxRounds: number; warnings: JunctionWarning[];
  /** 最后一轮比之前某一版更差时，按那一版（0 = 未修正的原分段）回退重渲并复检；check / spans 即回退后的交付版本。 */
  revertedToRound?: number;
}> {
  const maxRounds = Math.min(JUNCTION_FIX_MAX_ROUNDS, Math.max(0, params.maxRounds ?? JUNCTION_FIX_MAX_ROUNDS));
  const unwantedDone = (r: JunctionConsistencyReport) => r.junctions.every(j => j.pass || params.spans[j.index + 1]?.junctionIntent !== "unwanted");
  let plan = applyJunctionAutoMatch(params.spans, params.first.pairs, params.first);
  let rendered: typeof plan | null = null;
  let check: C = params.first;
  const rounds: Array<{ round: number; spans: GradeSpan[]; junctions: JunctionFixNote[]; check: C }> = [];
  while (plan.stepped.length && rounds.length < maxRounds) {
    const round = rounds.length + 1;
    check = await params.render(plan.spans, round);
    if (check.junctions.length !== params.first.junctions.length) throw new Error("调色复测条数不一致");
    rendered = plan;
    rounds.push({ round, spans: plan.spans, junctions: plan.junctions, check });
    if (unwantedDone(check)) break;
    plan = applyJunctionAutoMatch(params.spans, check.pairs, check, rendered.state);
  }
  // 防越修越差：交付的必须是各轮（含首检原片）里 unwanted 接点超差最小的一版；最后一轮不是最好时按最好那版回退重渲一次。
  const tol = GRADE_CONSISTENCY_TOLERANCE;
  const score = (r: JunctionConsistencyReport) => r.junctions.reduce((sum, j) => j.pass || params.spans[j.index + 1]?.junctionIntent !== "unwanted" ? sum
    : sum + Math.max(0, ...(Object.keys(tol) as Array<keyof typeof tol>).map(k => Math.abs(j.delta[k]) / tol[k] - 1)), 0);
  const tried = rendered?.state;
  let delivered: { spans: GradeSpan[]; adjusted: number[]; junctions: JunctionFixNote[] } | null = rendered;
  let revertedToRound: number | undefined;
  if (rounds.length) {
    const cands = [{ round: 0, s: score(params.first) }, ...rounds.map(r => ({ round: r.round, s: score(r.check) }))];
    const best = cands.reduce((m, c) => (c.s < m.s - 1e-9 ? c : m));
    const lastScore = cands[cands.length - 1].s;
    if (best.s < lastScore - 1e-9) {
      const src = best.round === 0 ? null : rounds[best.round - 1];
      const spans = src?.spans ?? params.spans;
      check = await params.render(spans, rounds.length + 1);
      if (check.junctions.length !== params.first.junctions.length) throw new Error("调色复测条数不一致");
      revertedToRound = best.round;
      delivered = { spans, adjusted: src ? spans.flatMap(x => (x.rampOf != null ? [x.rampOf + 1] : [])) : [], junctions: src?.junctions ?? rendered!.junctions };
    }
  }
  // plan 为「下一步打算」（可能未渲染）：其 too_short / no_step 说明用于警告原因；state 只认已渲染的（轮数 = 实际试过的轮数）。
  const warnings = buildJunctionWarnings(params.spans, check, { state: tried, notes: plan.junctions, attempted: true, maxRounds });
  return {
    adjusted: delivered?.adjusted ?? [],
    spans: delivered?.spans ?? plan.spans,
    junctions: delivered?.junctions ?? plan.junctions,
    ...(rendered ? { check } : {}),
    rounds, maxRounds, warnings,
    ...(revertedToRound != null ? { revertedToRound } : {}),
  };
}
