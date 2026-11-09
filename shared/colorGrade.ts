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

/**
 * 拼接调色参数：`all` 全片统一；`clips[i]` 逐镜头（浅合并覆盖 all，同上游 match_shots 的
 * `{ ...existingCorrections }` 叠加方式）；`referenceClipIndex` 指代表镜头，给出时合成后跑一致性检查。
 */
export const concatGradeSchema = z.object({
  all: colorCorrectionSchema.optional(),
  clips: z.array(colorCorrectionSchema.nullable()).min(1).max(12).optional(),
  referenceClipIndex: z.number().int().min(0).max(11).optional(),
}).strict();
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
  const ids = [grade.all?.lutId, ...(grade.clips ?? []).map(c => c?.lutId)].filter((v): v is string => !!v);
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
 * 按代表镜头批量算匹配参数（上游 multi-clip-grade 流程：先定 hero，再逐镜头 match_shots）。
 * 返回值可直接作为 `grade.clips`；代表镜头保持其原参数。结果再过一次 schema 收边界。
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
  return stats.map((s, i) => {
    const base = params.existing?.[i] ?? {};
    const next = i === referenceClipIndex ? { ...base } : deriveMatchingCorrections(ref, s, aspects, base);
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
