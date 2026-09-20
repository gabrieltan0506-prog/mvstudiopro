import { createHash } from "node:crypto";
import {
  NATIVE_DEEP_READ_RETRY_TEMPERATURES,
  NATIVE_DEEP_READ_ESCALATION_TEMPERATURES,
  NATIVE_DEEP_READ_SHOT_LONG_TAKE_REJECT_SEC,
} from "./manhuaNativeDeepReadGradient.js";

/**
 * 候选档数＝冻结重试梯度的长度。0920 用户令改成 5 发（0.7 / 0.65×2 / 0.6×2）之后，
 * 这里若继续写死 3，整段「跑满全部档位仍不合格 → 择优入库」的路径会直接抛错。
 */
// ⚠️ 本模块与 runner 互相 import：**必须惰性取值**，模块求值期读会拿到 undefined。
const attemptCount = () => NATIVE_DEEP_READ_RETRY_TEMPERATURES.length;
/**
 * 🔴 历史已付费选稿信封写的是 `attemptedCount: 3`（0920 之前是三档梯度）。
 * 只认当前档数＝旧信封回读一律判无效 → 那几段要**重新付费整形**。
 * 「停用 ≠ 撤销识别」：识别名单只增不减，往里加档数永远安全，删掉就是作废历史付费产出。
 * 升级档（3.1 Pro 三发）会让实际发数变 8，同样必须在识别范围内。
 */
const NATIVE_DEEP_READ_RECOGNIZED_ATTEMPT_COUNTS_LEGACY: readonly number[] = [3];
const recognizedAttemptCounts = () => [
  ...NATIVE_DEEP_READ_RECOGNIZED_ATTEMPT_COUNTS_LEGACY,
  attemptCount(),
  attemptCount() + NATIVE_DEEP_READ_ESCALATION_TEMPERATURES.length,
];
const maxRecognizedAttemptCount = () => Math.max(...recognizedAttemptCounts());
const attemptNumbers = () => Array.from(
  { length: maxRecognizedAttemptCount() }, (_, i) => i + 1);

/** 服务器记录：失败原稿仅供整形，不代表已经通过门禁。 */
export type NativeDeepReadAttemptSelection = {
  status: "selected_for_structuring_after_three_attempts";
  policyVersion: 1;
  /** 实际档数由冻结梯度决定（0920 起为 5）；字段名沿用历史，值不再写死。 */
  attemptedCount: number;
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
    !recognizedAttemptCounts().includes(Number(marker.attemptedCount)) ||
    !attemptNumbers().includes(marker.selectedAttemptNumber) ||
    marker.sourceDigest !== entry.sourceDigest ||
    marker.rawSha256 !== nativeAttemptRawSha256(entry.raw) ||
    !Array.isArray(marker.candidates) ||
    !marker.candidates.length ||
    marker.candidates.some(
      row =>
        !record(row) ||
        !attemptNumbers().includes(row.attemptNumber) ||
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
    throw new Error(`${attemptCount()} 档候选选择记录与原始证据不一致`);
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
    // 🔴 曾写死 33（＝30 + 10% 容差）。上限与容差一改，评分器就会把合法镜头算成错误，
    // 择优入库直接选错稿。改为跟随当前拒收线（0920：60 + 20% = 72 秒）。
    if (Number(shot.endSec) - Number(shot.startSec) > NATIVE_DEEP_READ_SHOT_LONG_TAKE_REJECT_SEC) errors++;
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
