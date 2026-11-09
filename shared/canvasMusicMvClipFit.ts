/**
 * MV 镜头出片后的实测适配（1109）：模型实出时长有随机短缺（请求 15 秒可能出 14.5/13.5 秒），
 * 时窗只是预算，须按实测调整，禁止变速硬塞（知识库 A 段原则；漫剧合成 renderSourceAudio 同样以实测时长为准）。
 *
 * - 素材段：不生成，按素材选段裁切（原有逻辑），只核实测时长够用。
 * - 生成画面段：实测时长 ≥ 入片区间（offset+duration）即裁到目标；短缺 → 该段重做（不整批）。
 * - 演唱段：生成片自带音轨与原歌该窗做包络互相关求偏移，首尾两处偏移之差即漂移；
 *   按偏移落位（trimIn = offset + lag），漂移 > 2 帧或落位后不够唱句尾 → 该段重做。
 * 所有实测时长、偏移、裁切点进回执，由调用方永久保存。
 */
import { onsetEnvelope } from "./manhuaBeatTable";

export const MV_FRAME_SEC = 1 / 30;
export const MV_SINGING_DRIFT_MAX_SEC = 2 * MV_FRAME_SEC;
/** 包络互相关峰值低于此值视为无法核对口型（生成片没有复现唱段）。 */
export const MV_SINGING_MIN_CONFIDENCE = 0.3;

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
  if (input.kind === "singing") {
    if (m.lagHeadSec === undefined || m.lagTailSec === undefined || !m.hasAudio)
      return { ...input, ...m, ok: false, trimInSec: base, trimOutSec: base + input.durationSec, reasonZh: "演唱段生成片无可核对的音轨，无法确认口型落位，需重做该段" };
    if (m.confidence !== undefined && m.confidence < MV_SINGING_MIN_CONFIDENCE)
      return { ...input, ...m, ok: false, trimInSec: base, trimOutSec: base + input.durationSec, reasonZh: `演唱段音轨与原歌相关度 ${m.confidence.toFixed(2)} 过低，无法确认口型落位，需重做该段` };
    const drift = Math.abs(m.lagTailSec - m.lagHeadSec);
    let lag = m.lagHeadSec;
    // 生成片比原歌早开始且早于 1 帧以内：按 0 落位（误差 ≤ 1 帧）
    if (lag < 0 && lag > -MV_FRAME_SEC) lag = 0;
    const trimIn = r(base + lag);
    const trimOut = r(trimIn + input.durationSec);
    if (drift > MV_SINGING_DRIFT_MAX_SEC + 1e-6)
      return { ...input, ...m, ok: false, trimInSec: trimIn, trimOutSec: trimOut, driftSec: r(drift), reasonZh: `演唱段口型漂移 ${(drift * 1000).toFixed(0)} 毫秒，超过 2 帧，需重做该段` };
    if (trimIn < 0)
      return { ...input, ...m, ok: false, trimInSec: trimIn, trimOutSec: trimOut, driftSec: r(drift), reasonZh: `演唱段比原歌晚起 ${(-lag * 1000).toFixed(0)} 毫秒以上，开头唱句缺失，需重做该段` };
    if (trimOut > m.measuredSec + 1e-6)
      return { ...input, ...m, ok: false, trimInSec: trimIn, trimOutSec: trimOut, driftSec: r(drift), shortfallSec: r(trimOut - m.measuredSec), reasonZh: `演唱段实测 ${m.measuredSec.toFixed(2)} 秒，落位后不够到唱句尾（缺 ${(trimOut - m.measuredSec).toFixed(2)} 秒），需重做该段` };
    return { ...input, ...m, ok: true, trimInSec: trimIn, trimOutSec: trimOut, driftSec: r(drift) };
  }
  const trimIn = r(base);
  const trimOut = r(base + input.durationSec);
  if (trimOut > m.measuredSec + 1e-6)
    return {
      ...input, ...m, ok: false, trimInSec: trimIn, trimOutSec: trimOut, shortfallSec: r(trimOut - m.measuredSec),
      reasonZh: input.kind === "footage"
        ? `素材实测 ${m.measuredSec.toFixed(2)} 秒，不够选段终点 ${trimOut.toFixed(2)} 秒，请改选素材`
        : `生成段实测 ${m.measuredSec.toFixed(2)} 秒，不够入片 ${trimOut.toFixed(2)} 秒（缺 ${(trimOut - m.measuredSec).toFixed(2)} 秒），需重做该段`,
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
