import type { ManhuaWorkbenchSegment } from "./manhuaScriptWorkbench.js";

/** 原稿自动分段的持久身份；revision 保留完整源证据，不以有碰撞的短哈希决定复用旧片。 */
export type ManhuaAutoSegmentBinding = {
  format: "mv-manhua-auto-segment-v1";
  episodeIndex: number;
  segmentIndex: number;
  sourceStartSec: number;
  sourceEndSec: number;
  durationSec: number;
  shotIndexes: number[];
  revision: string;
};

export function buildManhuaAutoSegmentBinding(
  episodeIndex: number,
  segment: ManhuaWorkbenchSegment,
  videoModel: string,
): ManhuaAutoSegmentBinding {
  const sourceStartSec = segment.sourceStartSec ?? 0;
  const sourceEndSec = segment.sourceEndSec ?? sourceStartSec + segment.shots.reduce((n, shot) => n + shot.durationSec, 0);
  return {
    format: "mv-manhua-auto-segment-v1",
    episodeIndex,
    segmentIndex: segment.index,
    sourceStartSec,
    sourceEndSec,
    durationSec: segment.durationSec,
    shotIndexes: Array.from(new Set(segment.shots.map(shot => shot.index))),
    revision: JSON.stringify({ episodeIndex, videoModel, sourceStartSec, sourceEndSec, durationSec: segment.durationSec, shots: segment.shots }),
  };
}

export function normalizeManhuaAutoSegmentBinding(raw: unknown): ManhuaAutoSegmentBinding | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Record<string, unknown>;
  if (v.format !== "mv-manhua-auto-segment-v1" ||
      !Number.isInteger(v.episodeIndex) || Number(v.episodeIndex) < 1 ||
      !Number.isInteger(v.segmentIndex) || Number(v.segmentIndex) < 1 ||
      typeof v.sourceStartSec !== "number" || !Number.isFinite(v.sourceStartSec) || v.sourceStartSec < 0 ||
      typeof v.sourceEndSec !== "number" || !Number.isFinite(v.sourceEndSec) || v.sourceEndSec <= v.sourceStartSec ||
      typeof v.durationSec !== "number" || !Number.isFinite(v.durationSec) || v.durationSec <= 0 ||
      v.sourceEndSec - v.sourceStartSec > v.durationSec + 0.000001 ||
      !Array.isArray(v.shotIndexes) || !v.shotIndexes.length ||
      !v.shotIndexes.every(n => Number.isInteger(n) && n > 0) ||
      typeof v.revision !== "string" || !v.revision.length) return undefined;
  return {
    format: v.format, episodeIndex: Number(v.episodeIndex), segmentIndex: Number(v.segmentIndex),
    sourceStartSec: v.sourceStartSec, sourceEndSec: v.sourceEndSec, durationSec: v.durationSec,
    shotIndexes: Array.from(new Set(v.shotIndexes)) as number[], revision: v.revision,
  };
}
