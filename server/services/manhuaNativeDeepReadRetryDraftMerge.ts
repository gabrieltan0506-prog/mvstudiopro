/**
 * 重试稿合并（0906 用户令：「只有重试的部分才走函数去重，去重后仍维持一个 JSON 丢给 GLM 整形」）。
 *
 * 规则（确定性、零模型、不改底稿一个字）：
 * - 底稿 = 过门禁的那一稿（三稿都没过时由调用方按既有评分挑的最佳稿）。底稿的每一行原样保留。
 * - 其他稿只往底稿里**补缺**：镜头按时间区间不与底稿任何镜头重叠才补；重点时刻按 atSec ±2 秒 + 同类别不存在才补；
 *   字幕按 atSec ±1 秒 + 同文本不存在才补；声音事件按 atSec ±1 秒 + 同 kind 不存在才补（挂到底稿覆盖该秒的音轨段上）。
 * - 位置撞上的一律以底稿为准，丢弃；不做「同位置不同观察」的裁决，不留未解决清单，所以 GLM 不需要冲突 schema。
 * - 四段总结（beatStructureZh 等）以底稿为准；底稿为空才取其他稿的。
 * - 输出与普通分片同形，可直接进现有整形提示词与观察锁；合并统计写进 advisory，不加新字段。
 */

type Row = Record<string, unknown>;

export type NativeDeepReadRetryDraft = {
  attemptNumber: number;
  raw: Row;
  passedGate: boolean;
};

export type NativeDeepReadRetryDraftMergeStats = {
  baseAttemptNumber: number;
  mergedFromAttempts: number[];
  addedShots: number;
  addedKeyMoments: number;
  addedSubtitles: number;
  addedAudioCues: number;
  filledProseFields: string[];
  /** 被丢弃（与底稿位置撞上）的其他稿记录数，只作统计 */
  droppedRecords: number;
};

export type NativeDeepReadRetryDraftMergeResult = {
  raw: Row;
  stats: NativeDeepReadRetryDraftMergeStats;
  summaryZh: string;
};

const SHOT_MIN_ADD_SEC = 0.5;
const KEY_MOMENT_WINDOW_SEC = 2;
const SUBTITLE_WINDOW_SEC = 1;
const AUDIO_CUE_WINDOW_SEC = 1;
const PROSE_FIELDS = ["beatStructureZh", "moodArcZh", "reusableZh", "genPromptHintZh"] as const;

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const rows = (raw: Row, key: string): Row[] => (Array.isArray(raw[key]) ? (raw[key] as Row[]).filter((r) => r && typeof r === "object") : []);
const num = (value: unknown): number => Number(value);
const finite = (value: unknown): boolean => Number.isFinite(Number(value));
const text = (value: unknown): string => String(value ?? "").trim();

/** 只补落在本段区间内、且不与底稿任何镜头重叠的镜头。 */
function addShots(base: Row[], candidates: Row[], span: { startSec: number; endSec: number }): { added: Row[]; dropped: number } {
  const added: Row[] = [];
  let dropped = 0;
  const occupied = base.map((s) => ({ start: num(s.startSec), end: num(s.endSec) })).filter((s) => finite(s.start) && finite(s.end));
  for (const shot of candidates) {
    const start = num(shot.startSec);
    const end = num(shot.endSec);
    if (!finite(start) || !finite(end) || end - start < SHOT_MIN_ADD_SEC || start < span.startSec - 1e-6 || end > span.endSec + 1e-6) { dropped += 1; continue; }
    const overlaps = occupied.some((o) => Math.min(o.end, end) - Math.max(o.start, start) > 1e-6);
    if (overlaps) { dropped += 1; continue; }
    added.push(copy(shot));
    occupied.push({ start, end });
  }
  return { added, dropped };
}

function addPoints(
  base: Row[],
  candidates: Row[],
  windowSec: number,
  sameKind: (a: Row, b: Row) => boolean,
): { added: Row[]; dropped: number } {
  const added: Row[] = [];
  let dropped = 0;
  const seen = [...base];
  for (const row of candidates) {
    const at = num(row.atSec);
    if (!finite(at)) { dropped += 1; continue; }
    const dup = seen.some((s) => finite(s.atSec) && Math.abs(num(s.atSec) - at) <= windowSec && sameKind(s, row));
    if (dup) { dropped += 1; continue; }
    added.push(copy(row));
    seen.push(row);
  }
  return { added, dropped };
}

function audioTracks(raw: Row): Row[] {
  return rows(raw, "audioResolution").flatMap((chunk) => {
    const analysis = chunk.analysis as Row | undefined;
    return analysis && Array.isArray(analysis.audioTrack) ? (analysis.audioTrack as Row[]) : [];
  });
}

/** 把其他稿的声音事件补进底稿覆盖该秒的音轨段；底稿没有覆盖该秒的音轨段则丢弃（不扩音轨）。 */
function addAudioCues(base: Row, candidates: Row[]): { added: number; dropped: number } {
  const tracks = audioTracks(base);
  const existing = tracks.flatMap((t) => (Array.isArray(t.cues) ? (t.cues as Row[]) : []));
  let added = 0;
  let dropped = 0;
  for (const other of candidates) {
    for (const track of audioTracks(other)) {
      for (const cue of Array.isArray(track.cues) ? (track.cues as Row[]) : []) {
        const at = num(cue.atSec);
        if (!finite(at)) { dropped += 1; continue; }
        const dup = existing.some((c) => finite(c.atSec) && Math.abs(num(c.atSec) - at) <= AUDIO_CUE_WINDOW_SEC && text(c.kind) === text(cue.kind));
        if (dup) { dropped += 1; continue; }
        const host = tracks.find((t) => finite(t.fromSec) && finite(t.toSec) && num(t.fromSec) <= at && at <= num(t.toSec));
        if (!host) { dropped += 1; continue; }
        if (!Array.isArray(host.cues)) host.cues = [];
        (host.cues as Row[]).push(copy(cue));
        existing.push(cue);
        added += 1;
      }
    }
  }
  for (const track of tracks) {
    if (Array.isArray(track.cues)) (track.cues as Row[]).sort((a, b) => num(a.atSec) - num(b.atSec));
  }
  return { added, dropped };
}

export function mergeNativeDeepReadRetryDrafts(input: {
  segmentIndex: number;
  startSec: number;
  endSec: number;
  drafts: readonly NativeDeepReadRetryDraft[];
  /** 三稿都没过时调用方指定底稿；缺省取第一份过门禁的稿 */
  baseAttemptNumber?: number;
}): NativeDeepReadRetryDraftMergeResult {
  const drafts = input.drafts.filter((d) => d && d.raw && typeof d.raw === "object");
  if (drafts.length < 2) throw new Error("重试稿合并至少需要两份稿");
  const base = input.baseAttemptNumber !== undefined
    ? drafts.find((d) => d.attemptNumber === input.baseAttemptNumber)
    : drafts.find((d) => d.passedGate) ?? drafts[0];
  if (!base) throw new Error("重试稿合并找不到底稿");
  const others = drafts.filter((d) => d !== base).sort((a, b) => a.attemptNumber - b.attemptNumber);
  const merged = copy(base.raw);
  // 剥掉底稿上被拒时贴的标记（底稿若是三稿均败的最佳稿）；其他稿的标记不进合并结果
  delete merged.gateMarked; delete merged.gateMarkedZh; delete merged.attemptNumber;
  const span = { startSec: input.startSec, endSec: input.endSec };

  const baseShots = rows(merged, "shots");
  const shotAdd = addShots(baseShots, others.flatMap((d) => rows(d.raw, "shots")), span);
  if (shotAdd.added.length) {
    merged.shots = [...baseShots, ...shotAdd.added].sort((a, b) => num(a.startSec) - num(b.startSec) || num(a.endSec) - num(b.endSec));
  }
  const kmAdd = addPoints(rows(merged, "keyMoments"), others.flatMap((d) => rows(d.raw, "keyMoments")), KEY_MOMENT_WINDOW_SEC,
    (a, b) => text(a.kindZh) === text(b.kindZh));
  if (kmAdd.added.length) merged.keyMoments = [...rows(merged, "keyMoments"), ...kmAdd.added].sort((a, b) => num(a.atSec) - num(b.atSec));
  const subAdd = addPoints(rows(merged, "subtitles"), others.flatMap((d) => rows(d.raw, "subtitles")), SUBTITLE_WINDOW_SEC,
    (a, b) => text(a.textZh) === text(b.textZh));
  if (subAdd.added.length) merged.subtitles = [...rows(merged, "subtitles"), ...subAdd.added].sort((a, b) => num(a.atSec) - num(b.atSec));
  const cueAdd = addAudioCues(merged, others.map((d) => d.raw));

  const filledProseFields: string[] = [];
  for (const key of PROSE_FIELDS) {
    if (text(merged[key])) continue;
    const donor = others.find((d) => text(d.raw[key]));
    if (donor) { merged[key] = donor.raw[key]; filledProseFields.push(key); }
  }

  const stats: NativeDeepReadRetryDraftMergeStats = {
    baseAttemptNumber: base.attemptNumber,
    mergedFromAttempts: others.map((d) => d.attemptNumber),
    addedShots: shotAdd.added.length,
    addedKeyMoments: kmAdd.added.length,
    addedSubtitles: subAdd.added.length,
    addedAudioCues: cueAdd.added,
    filledProseFields,
    droppedRecords: shotAdd.dropped + kmAdd.dropped + subAdd.dropped + cueAdd.dropped,
  };
  const summaryZh = `第${input.segmentIndex + 1}段 ${drafts.length} 稿合并：以第${base.attemptNumber}稿为底`
    + `，补入镜头 ${stats.addedShots}、重点时刻 ${stats.addedKeyMoments}、字幕 ${stats.addedSubtitles}、声音事件 ${stats.addedAudioCues}`
    + (filledProseFields.length ? `，补齐总结 ${filledProseFields.join("/")}` : "")
    + `；与底稿位置撞上丢弃 ${stats.droppedRecords} 条`;
  return { raw: merged, stats, summaryZh };
}
