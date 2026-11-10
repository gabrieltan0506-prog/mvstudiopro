/**
 * MV 镜头出片后的实测适配（1109）：模型实出时长有随机短缺（请求 15 秒可能出 14.5/13.5 秒），
 * 时窗只是预算，须按实测调整，禁止变速硬塞（知识库 A 段原则；漫剧合成 renderSourceAudio 同样以实测时长为准）。
 *
 * - 素材段：不生成，按素材选段裁切（原有逻辑），只核实测时长够用。
 * - 生成画面段：实测时长 ≥ 入片区间（offset+duration）即裁到目标；短缺 → 该段重做（不整批）。
 * - 演唱段：按原歌绝对时间帧精确落位（trimIn = 入片偏移），只核实测时长够到唱句尾；
 *   口型由视觉核验另判（嘴部张合度 × 原歌 200–3k Hz 人声包络互相关，相关 ≥0.5 且 |偏移| ≤2 帧）。
 * 所有实测时长、偏移、裁切点进回执，由调用方永久保存。
 */
import { onsetEnvelope } from "./manhuaBeatTable";

export const MV_FRAME_SEC = 1 / 30;


export type MvClipFitInput = {
  shotId: string;
  kind: "generated" | "singing" | "footage";
  /** 本段在原歌中的入片起点（绝对秒）。 */
  songStartSec: number;
  /** 镜头内起点偏移（高光切边时 > 0）。 */
  offsetSec: number;
  /** 入片时长（30fps 量化后）。 */
  durationSec: number;
  /** 素材段的源内起点（footage 才有）。 */
  sourceStartSec?: number;
};

export type MvClipFitMeasure = {
  measuredSec: number;
  hasAudio: boolean;
  /** 演唱段：首窗与尾窗的互相关偏移（秒，正值 = 生成片比原歌晚）与置信度。 */
  lagHeadSec?: number;
  lagTailSec?: number;
  confidence?: number;
};

export type MvClipFitResult = MvClipFitInput & MvClipFitMeasure & {
  ok: boolean;
  trimInSec: number;
  trimOutSec: number;
  driftSec?: number;
  shortfallSec?: number;
  reasonZh?: string;
};

/** 依据实测给出裁切点与合格判定（纯函数）。 */
export function planMvClipFit(input: MvClipFitInput, m: MvClipFitMeasure): MvClipFitResult {
  const base = (input.kind === "footage" ? input.sourceStartSec ?? 0 : 0) + input.offsetSec;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  // 演唱镜：@音频1 从片首对齐原歌该窗，按请求时间线落位（trimIn = 入片偏移），不平移、不变速。
  // 1109：模型自带音轨不会复现原唱，不能用音轨相关判口型；口型由视觉核验（嘴部张合 × 人声包络）另判。
  const trimIn = r(base);
  const trimOut = r(base + input.durationSec);
  if (trimOut > m.measuredSec + 1e-6)
    return {
      ...input, ...m, ok: false, trimInSec: trimIn, trimOutSec: trimOut, shortfallSec: r(trimOut - m.measuredSec),
      reasonZh: input.kind === "footage"
        ? `素材实测 ${m.measuredSec.toFixed(2)} 秒，不够选段终点 ${trimOut.toFixed(2)} 秒，请改选素材`
        : `${input.kind === "singing" ? "演唱段" : "生成段"}实测 ${m.measuredSec.toFixed(2)} 秒，不够入片 ${trimOut.toFixed(2)} 秒（缺 ${(trimOut - m.measuredSec).toFixed(2)} 秒），需重做该段`,
    };
  return { ...input, ...m, ok: true, trimInSec: trimIn, trimOutSec: trimOut };
}

/**
 * 起音包络互相关求偏移：ref = 原歌窗，probe = 生成片同长音轨（含前后余量）。
 * 返回 probe 中与 ref 起点对齐的位置（秒，10ms 分辨率，抛物线插值）与归一化相关峰值。
 */
export function estimateEnvelopeLagSec(
  ref: ArrayLike<number>,
  probe: ArrayLike<number>,
  sampleRate: number,
  maxLagSec = 1,
): { lagSec: number; confidence: number } {
  const a = onsetEnvelope(ref, sampleRate);
  const b = onsetEnvelope(probe, sampleRate);
  const hop = 0.01;
  const maxLag = Math.round(maxLagSec / hop);
  const norm = (x: number[]) => {
    const mean = x.reduce((s, v) => s + v, 0) / (x.length || 1);
    return x.map(v => v - mean);
  };
  const A = norm(a);
  const B = norm(b);
  const ea = Math.sqrt(A.reduce((s, v) => s + v * v, 0)) || 1;
  const scores: number[] = [];
  let best = -Infinity;
  let bestLag = 0;
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let dot = 0;
    let eb = 0;
    for (let i = 0; i < A.length; i += 1) {
      const j = i + lag;
      if (j < 0 || j >= B.length) continue;
      dot += A[i]! * B[j]!;
      eb += B[j]! * B[j]!;
    }
    const score = dot / (ea * (Math.sqrt(eb) || 1));
    scores.push(score);
    if (score > best) { best = score; bestLag = lag; }
  }
  const idx = bestLag + maxLag;
  let frac = 0;
  if (idx > 0 && idx < scores.length - 1) {
    const [y0, y1, y2] = [scores[idx - 1]!, scores[idx]!, scores[idx + 1]!];
    const den = y0 - 2 * y1 + y2;
    if (Math.abs(den) > 1e-12) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den));
  }
  return { lagSec: Math.round((bestLag + frac) * hop * 1000) / 1000, confidence: Math.round(best * 1000) / 1000 };
}


/** 视觉口型核验阈值（1109 用户口径）：相关 ≥0.5 且 |偏移| ≤2 帧。 */
export const MV_LIPSYNC_MIN_CORR = 0.5;
export const MV_LIPSYNC_MAX_LAG_FRAMES = 2;
/**
 * 嘴部张合度序列（每帧一个值，缺脸帧为 NaN）与原歌人声能量包络（同帧率）做归一化互相关。
 * 返回相关系数、最优偏移（帧，正值＝口型比歌声晚）与是否通过。
 */
export function lipSyncCorrelation(mouth: readonly number[], vocal: readonly number[], maxLagFrames = 10) {
  const n = Math.min(mouth.length, vocal.length);
  let best = { corr: -1, lag: 0 };
  for (let lag = -maxLagFrames; lag <= maxLagFrames; lag++) {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = i + lag;
      if (j < 0 || j >= mouth.length) continue;
      const m = mouth[j]!;
      if (!Number.isFinite(m)) continue;
      xs.push(m); ys.push(vocal[i]!);
    }
    if (xs.length < 15) continue;
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (let k = 0; k < xs.length; k++) { sxy += (xs[k]! - mx) * (ys[k]! - my); sxx += (xs[k]! - mx) ** 2; syy += (ys[k]! - my) ** 2; }
    const corr = sxy / Math.sqrt(sxx * syy || 1);
    if (corr > best.corr) best = { corr, lag };
  }
  const faceCoverage = mouth.slice(0, n).filter(Number.isFinite).length / Math.max(1, n);
  return { corr: Math.round(best.corr * 1000) / 1000, lagFrames: best.lag, faceCoverage: Math.round(faceCoverage * 1000) / 1000, pass: best.corr >= MV_LIPSYNC_MIN_CORR && Math.abs(best.lag) <= MV_LIPSYNC_MAX_LAG_FRAMES };
}
