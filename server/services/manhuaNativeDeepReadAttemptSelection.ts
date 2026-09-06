import { createHash } from "node:crypto";

/** 服务器记录：失败原稿仅供整形，不代表已经通过门禁。 */
export type NativeDeepReadAttemptSelection = {
  status: "selected_for_structuring_after_three_attempts";
  policyVersion: 1;
  attemptedCount: 3;
  selectedAttemptNumber: number;
  sourceDigest: string;
  rawSha256: string;
  candidates: Array<{
    attemptNumber: number;
    rawAttemptEvidenceObjectName?: string;
    reasonZh: string;
    score: number[];
  }>;
};
const record = (x: unknown): x is Record<string, unknown> =>
  Boolean(x) && typeof x === "object" && !Array.isArray(x);
const rows = (x: unknown): Record<string, unknown>[] =>
  Array.isArray(x) ? x.filter(record) : [];
export const nativeAttemptRawSha256 = (raw: Record<string, unknown>) =>
  createHash("sha256").update(JSON.stringify(raw)).digest("hex");

/** 只接受缓存信封里的服务器状态；模型 raw 中同名字段无效。 */
export function hasNativeAttemptSelection(entry: {
  raw: Record<string, unknown>;
  sourceDigest: string;
  attemptSelection?: NativeDeepReadAttemptSelection;
}): boolean {
  const marker = entry.attemptSelection;
  if (marker === undefined) return false;
  if (
    !record(marker) ||
    marker.status !== "selected_for_structuring_after_three_attempts" ||
    marker.policyVersion !== 1 ||
    marker.attemptedCount !== 3 ||
    ![1, 2, 3].includes(marker.selectedAttemptNumber) ||
    marker.sourceDigest !== entry.sourceDigest ||
    marker.rawSha256 !== nativeAttemptRawSha256(entry.raw) ||
    !Array.isArray(marker.candidates) ||
    !marker.candidates.length ||
    marker.candidates.some(
      row =>
        !record(row) ||
        ![1, 2, 3].includes(row.attemptNumber) ||
        typeof row.reasonZh !== "string" ||
        !Array.isArray(row.score) ||
        row.score.length !== 4 ||
        !row.score.every(Number.isFinite)
    ) ||
    new Set(marker.candidates.map(row => row.attemptNumber)).size !==
      marker.candidates.length ||
    !marker.candidates.some(
      row => row.attemptNumber === marker.selectedAttemptNumber
    )
  ) {
    throw new Error("三档候选选择记录与原始证据不一致");
  }
  return true;
}

/** 不改秒位、不拼稿；覆盖优先，其次结构错误和实际非空证据，平分保留先前尝试。 */
export function scoreNativeAttempt(
  raw: Record<string, unknown>,
  startSec: number,
  endSec: number,
  hasAudio: boolean
): number[] | null {
  const shots = rows(raw.shots);
  if (!shots.some(row => typeof row.hintZh === "string" && row.hintZh.trim()))
    return null;
  let errors = 0;
  const coverage = (
    items: Record<string, unknown>[],
    start: number,
    end: number,
    from: string,
    to: string
  ) => {
    const spans: number[][] = [];
    for (const row of items) {
      const a = row[from],
        b = row[to];
      if (
        typeof a !== "number" ||
        typeof b !== "number" ||
        !Number.isFinite(a) ||
        !Number.isFinite(b) ||
        b <= a
      ) {
        errors++;
        continue;
      }
      if (a < start || b > end) errors++;
      spans.push([Math.max(start, a), Math.min(end, b)]);
    }
    let cursor = start,
      covered = 0;
    for (const [a, b] of spans.sort((a, b) => a[0]! - b[0]!)) {
      covered += Math.max(0, b! - Math.max(cursor, a!));
      cursor = Math.max(cursor, b!);
    }
    return covered / (end - start);
  };
  const visual = coverage(shots, startSec, endSec, "startSec", "endSec");
  const tracks = rows(raw.audioResolution).flatMap(chunk =>
    rows(record(chunk.analysis) ? chunk.analysis.audioTrack : undefined)
  );
  const audio = hasAudio
    ? coverage(tracks, 0, endSec - startSec, "fromSec", "toSec")
    : visual;
  for (const shot of shots)
    for (const key of ["hintZh", "actionZh", "evidenceRole", "detailLevel"]) {
      if (typeof shot[key] !== "string" || !String(shot[key]).trim()) errors++;
    }
  for (const shot of shots)
    if (Number(shot.endSec) - Number(shot.startSec) > 33) errors++;
  for (const track of tracks)
    for (const cue of rows(track.cues)) {
      if (
        typeof cue.atSec !== "number" ||
        !Number.isFinite(cue.atSec) ||
        cue.atSec < Number(track.fromSec) ||
        cue.atSec > Number(track.toSec)
      )
        errors++;
    }
  const evidence =
    new Set(
      shots
        .map(row => (typeof row.hintZh === "string" ? row.hintZh.trim() : ""))
        .filter(Boolean)
    ).size +
    rows(raw.subtitles).length +
    rows(raw.keyMoments).length +
    tracks.reduce((sum, row) => sum + rows(row.cues).length, 0);
  return [Math.min(visual, audio), (visual + audio) / 2, -errors, evidence];
}
