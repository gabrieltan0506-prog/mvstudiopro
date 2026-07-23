/**
 * 自动建议细剪进出点（MVP）：ffmpeg silencedetect → 有声区间 → 收紧 in/out。
 * 不调大模型；下一档再对齐导戏秒轴。
 */

import {
  clampFineCut,
  defaultFineCut,
  type ManhuaFineCutByShot,
  type ManhuaFineCutTrim,
} from "./manhuaEditFineCut.js";

export type ManhuaSpeechRegion = { start: number; end: number };

export type ManhuaAutoCutSuggestResult = {
  trim: ManhuaFineCutTrim;
  source: "speech" | "fallback";
  labelZh: string;
  /** 有声总覆盖秒 */
  speechSec: number;
};

const DEFAULT_PAD_SEC = 0.25;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 合并重叠/相邻有声区间 */
export function mergeManhuaSpeechRegions(
  regions: ManhuaSpeechRegion[],
  gapMergeSec = 0.35,
): ManhuaSpeechRegion[] {
  const sorted = [...regions]
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .sort((a, b) => a.start - b.start);
  if (!sorted.length) return [];
  const out: ManhuaSpeechRegion[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.start <= last.end + gapMergeSec) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out.map((r) => ({ start: round2(r.start), end: round2(r.end) }));
}

/**
 * 整段视频：用有声包络建议一条进出点（去头尾长静音）。
 */
export function suggestManhuaFineCutFromSpeechRegions(
  regions: ManhuaSpeechRegion[] | null | undefined,
  durationSec: number,
  opts?: { padSec?: number },
): ManhuaAutoCutSuggestResult {
  const d = Math.max(0.5, Number(durationSec) || 0.5);
  const padRaw = Number(opts?.padSec);
  const pad = Math.max(
    0,
    Number.isFinite(padRaw) ? padRaw : DEFAULT_PAD_SEC,
  );
  const merged = mergeManhuaSpeechRegions(regions || []);
  const speechSec = round2(merged.reduce((n, r) => n + (r.end - r.start), 0));

  if (!merged.length) {
    const trim = defaultFineCut(d);
    return {
      trim,
      source: "fallback",
      labelZh: "未检出有效有声，保留全长",
      speechSec: 0,
    };
  }

  const envelopeStart = Math.max(0, merged[0]!.start - pad);
  const envelopeEnd = Math.min(d, merged[merged.length - 1]!.end + pad);
  // 有声过短时勿裁成碎片：至少保留源长 55% 或 2s
  const minKeep = Math.min(d, Math.max(2, d * 0.55));
  let inSec = envelopeStart;
  let outSec = envelopeEnd;
  if (outSec - inSec < minKeep) {
    const mid = (envelopeStart + envelopeEnd) / 2;
    inSec = Math.max(0, mid - minKeep / 2);
    outSec = Math.min(d, inSec + minKeep);
    if (outSec - inSec < minKeep) inSec = Math.max(0, outSec - minKeep);
  }

  const trim = clampFineCut(d, { inSec, outSec });
  const cutHead = trim.inSec > 0.25;
  const cutTail = trim.outSec < d - 0.25;
  return {
    trim,
    source: "speech",
    labelZh: cutHead || cutTail
      ? `气口建议 ${trim.inSec}–${trim.outSec}s（有声约 ${speechSec}s）`
      : `有声已铺满，几乎无需裁切`,
    speechSec,
  };
}

/**
 * 段成片内多镜：按时长比例均分绝对时间窗，再与有声求交 → 各镜本地进出点。
 * （导戏秒轴对齐为下一档）
 */
export function suggestManhuaFineCutsForSegmentShots(params: {
  speechRegions: ManhuaSpeechRegion[];
  videoDurationSec: number;
  shots: Array<{ shotIndex: number; durationSec: number }>;
  padSec?: number;
}): {
  fineCutByShot: ManhuaFineCutByShot;
  segmentSuggest: ManhuaAutoCutSuggestResult;
} {
  const videoDur = Math.max(0.5, Number(params.videoDurationSec) || 0.5);
  const pad = Math.max(0, Number(params.padSec) ?? DEFAULT_PAD_SEC);
  const segmentSuggest = suggestManhuaFineCutFromSpeechRegions(
    params.speechRegions,
    videoDur,
    { padSec: pad },
  );
  const shots = params.shots.filter((s) => s.shotIndex >= 1);
  const fineCutByShot: ManhuaFineCutByShot = {};
  if (!shots.length) {
    return { fineCutByShot, segmentSuggest };
  }

  const sumDur = shots.reduce((n, s) => n + Math.max(0.5, Number(s.durationSec) || 0.5), 0);
  const merged = mergeManhuaSpeechRegions(params.speechRegions);
  let cursor = 0;

  for (const shot of shots) {
    const shotDur = Math.max(0.5, Number(shot.durationSec) || 0.5);
    const winStart = (cursor / sumDur) * videoDur;
    const winEnd = ((cursor + shotDur) / sumDur) * videoDur;
    cursor += shotDur;

    const localRegions: ManhuaSpeechRegion[] = [];
    for (const r of merged) {
      const a = Math.max(r.start, winStart);
      const b = Math.min(r.end, winEnd);
      if (b - a >= 0.2) {
        localRegions.push({
          start: a - winStart,
          end: b - winStart,
        });
      }
    }

    const localDur = Math.max(0.5, winEnd - winStart);
    // 映射到工作台镜时长刻度
    const scale = shotDur / localDur;
    const scaled = localRegions.map((r) => ({
      start: r.start * scale,
      end: r.end * scale,
    }));
    const one = suggestManhuaFineCutFromSpeechRegions(scaled, shotDur, { padSec: pad });
    fineCutByShot[shot.shotIndex] = one.trim;
  }

  return { fineCutByShot, segmentSuggest };
}
