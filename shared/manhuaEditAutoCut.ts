/**
 * 自动建议细剪进出点：ffmpeg silencedetect → 有声区间 → 收紧 in/out。
 * 镜窗优先导戏秒轴；无秒轴时按时长均分。合成侧用绝对 trim 真裁切。
 */

import { parseManhuaClipDirectorCardSummary } from "./manhuaClipDirectorCard.js";
import {
  clampFineCut,
  defaultFineCut,
  type ManhuaFineCutByShot,
  type ManhuaFineCutTrim,
} from "./manhuaEditFineCut.js";

export type ManhuaSpeechRegion = { start: number; end: number };

export type ManhuaShotTimeWindow = {
  shotIndex: number;
  winStart: number;
  winEnd: number;
  source: "cue" | "even";
};

export type ManhuaAutoCutSuggestResult = {
  trim: ManhuaFineCutTrim;
  source: "speech" | "fallback";
  labelZh: string;
  speechSec: number;
};

/** 写入成片节点、供合成 ffmpeg 裁切的绝对秒片 */
export type ManhuaAssembleShotPiece = {
  shotIndex: number;
  trimInSec: number;
  trimOutSec: number;
  durationSec: number;
};

const DEFAULT_PAD_SEC = 0.25;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function resolvePad(padSec?: number): number {
  const padRaw = Number(padSec);
  return Math.max(0, Number.isFinite(padRaw) ? padRaw : DEFAULT_PAD_SEC);
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
  const pad = resolvePad(opts?.padSec);
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
 * 段内各镜时间窗：优先导戏秒轴 cueRows，否则按时长均分。
 */
export function resolveManhuaShotWindowsForSegment(params: {
  directorPrompt?: string | null;
  videoDurationSec: number;
  shots: Array<{ shotIndex: number; durationSec: number }>;
}): ManhuaShotTimeWindow[] {
  const videoDur = Math.max(0.5, Number(params.videoDurationSec) || 0.5);
  const shots = params.shots.filter((s) => s.shotIndex >= 1);
  if (!shots.length) return [];

  const summary = parseManhuaClipDirectorCardSummary(params.directorPrompt);
  const cueRows = summary.cueRows || [];
  if (cueRows.length) {
    const fromCue: ManhuaShotTimeWindow[] = [];
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i]!;
      const byLabel =
        cueRows.find((r) => r.roleLabelZh === `镜${shot.shotIndex}`) ||
        cueRows.find((r) => new RegExp(`分镜\\s*${shot.shotIndex}\\b`).test(r.roleLabelZh)) ||
        cueRows.find((r) => new RegExp(`镜\\s*${shot.shotIndex}\\b`).test(r.microOrActionZh));
      const byOrder = cueRows.length === shots.length ? cueRows[i] : undefined;
      const cue = byLabel || byOrder;
      if (cue && cue.endSec > cue.startSec) {
        const winStart = Math.max(0, Math.min(videoDur, cue.startSec));
        const winEnd = Math.max(winStart + 0.5, Math.min(videoDur, cue.endSec));
        fromCue.push({
          shotIndex: shot.shotIndex,
          winStart: round2(winStart),
          winEnd: round2(winEnd),
          source: "cue",
        });
        continue;
      }
      break;
    }
    if (fromCue.length === shots.length) return fromCue;
  }

  const sumDur = shots.reduce((n, s) => n + Math.max(0.5, Number(s.durationSec) || 0.5), 0);
  let cursor = 0;
  return shots.map((shot) => {
    const shotDur = Math.max(0.5, Number(shot.durationSec) || 0.5);
    const winStart = (cursor / sumDur) * videoDur;
    const winEnd = ((cursor + shotDur) / sumDur) * videoDur;
    cursor += shotDur;
    return {
      shotIndex: shot.shotIndex,
      winStart: round2(winStart),
      winEnd: round2(Math.max(winStart + 0.5, winEnd)),
      source: "even" as const,
    };
  });
}

/**
 * 段成片内多镜：导戏秒轴窗（或均分）∩ 有声 → 各镜本地进出点。
 */
export function suggestManhuaFineCutsForSegmentShots(params: {
  speechRegions: ManhuaSpeechRegion[];
  videoDurationSec: number;
  shots: Array<{ shotIndex: number; durationSec: number }>;
  directorPrompt?: string | null;
  padSec?: number;
}): {
  fineCutByShot: ManhuaFineCutByShot;
  segmentSuggest: ManhuaAutoCutSuggestResult;
  windows: ManhuaShotTimeWindow[];
  windowSource: "cue" | "even" | "mixed";
} {
  const videoDur = Math.max(0.5, Number(params.videoDurationSec) || 0.5);
  const pad = resolvePad(params.padSec);
  const segmentSuggest = suggestManhuaFineCutFromSpeechRegions(
    params.speechRegions,
    videoDur,
    { padSec: pad },
  );
  const shots = params.shots.filter((s) => s.shotIndex >= 1);
  const fineCutByShot: ManhuaFineCutByShot = {};
  const windows = resolveManhuaShotWindowsForSegment({
    directorPrompt: params.directorPrompt,
    videoDurationSec: videoDur,
    shots,
  });
  if (!shots.length) {
    return { fineCutByShot, segmentSuggest, windows, windowSource: "even" };
  }

  const merged = mergeManhuaSpeechRegions(params.speechRegions);
  const winByShot = new Map(windows.map((w) => [w.shotIndex, w] as const));

  for (const shot of shots) {
    const shotDur = Math.max(0.5, Number(shot.durationSec) || 0.5);
    const win = winByShot.get(shot.shotIndex);
    const winStart = win?.winStart ?? 0;
    const winEnd = win?.winEnd ?? videoDur;
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
    const scale = shotDur / localDur;
    const scaled = localRegions.map((r) => ({
      start: r.start * scale,
      end: r.end * scale,
    }));
    const one = suggestManhuaFineCutFromSpeechRegions(scaled, shotDur, { padSec: pad });
    fineCutByShot[shot.shotIndex] = one.trim;
  }

  const sources = new Set(windows.map((w) => w.source));
  const windowSource: "cue" | "even" | "mixed" =
    sources.size > 1 ? "mixed" : sources.has("cue") ? "cue" : "even";

  return { fineCutByShot, segmentSuggest, windows, windowSource };
}

/**
 * 把镜级 fineCut 映射回源片绝对秒，供合成逐片 ffmpeg 裁切。
 */
export function buildManhuaAssembleShotPieces(params: {
  videoDurationSec: number;
  fineCutByShot: ManhuaFineCutByShot;
  windows: ManhuaShotTimeWindow[];
  shots: Array<{ shotIndex: number; durationSec: number }>;
}): ManhuaAssembleShotPiece[] {
  const videoDur = Math.max(0.5, Number(params.videoDurationSec) || 0.5);
  const winByShot = new Map(params.windows.map((w) => [w.shotIndex, w] as const));
  const out: ManhuaAssembleShotPiece[] = [];

  for (const shot of params.shots) {
    if (shot.shotIndex < 1) continue;
    const shotDur = Math.max(0.5, Number(shot.durationSec) || 0.5);
    const win = winByShot.get(shot.shotIndex);
    const winStart = win?.winStart ?? 0;
    const winEnd = win?.winEnd ?? videoDur;
    const localDur = Math.max(0.5, winEnd - winStart);
    const trim = clampFineCut(
      shotDur,
      params.fineCutByShot[shot.shotIndex] ?? defaultFineCut(shotDur),
    );
    const absIn = winStart + (trim.inSec / shotDur) * localDur;
    const absOut = winStart + (trim.outSec / shotDur) * localDur;
    const trimInSec = round2(Math.max(0, Math.min(videoDur, absIn)));
    const trimOutSec = round2(Math.max(trimInSec + 0.5, Math.min(videoDur, absOut)));
    out.push({
      shotIndex: shot.shotIndex,
      trimInSec,
      trimOutSec,
      durationSec: round2(trimOutSec - trimInSec),
    });
  }
  return out;
}
