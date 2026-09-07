/**
 * 重试稿合并（0906 用户令：「只有重试的部分才走函数去重，去重后仍维持一个 JSON 丢给 GLM 整形」）。
 *
 * 规则（确定性、零模型、不改底稿一个字）：
 * - 底稿 = 过门禁的那一稿（三稿都没过时由调用方按既有评分挑的最佳稿）。底稿的每一行原样保留。
 * - 其他稿只往底稿里**补缺**：镜头按时间区间不与底稿任何镜头重叠才补；字幕按「归一化文本相同」或「±3 秒且字重合 ≥60%」判重，
 *   不重才补；声音事件按 atSec ±3 秒（不分 kind）判重，不重才补（挂到底稿覆盖该秒的音轨段上）。
 * - 重点时刻是「选哪些时刻算重点」的判断，不是事实，**以底稿为准不叠加**（0906 实弹：两稿各挑 8—9 个几乎不重合，叠加成 17 个把重点稀释）；
 *   只有底稿少于 3 个时才从其他稿按 ≥10 秒间隔补到 3 个。
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
/** 点状记录允许的越界容差（与时间轴容差同量级）；超出本片范围的记录不补 */
const RANGE_TOLERANCE_SEC = 0.5;
const KEY_MOMENT_FLOOR = 3;
const KEY_MOMENT_TOPUP_GAP_SEC = 10;
const SUBTITLE_WINDOW_SEC = 3;
const SUBTITLE_SIMILARITY = 0.6;
const AUDIO_CUE_WINDOW_SEC = 3;
const PROSE_FIELDS = ["beatStructureZh", "moodArcZh", "reusableZh", "genPromptHintZh"] as const;

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const rows = (raw: Row, key: string): Row[] => (Array.isArray(raw[key]) ? (raw[key] as Row[]).filter((r) => r && typeof r === "object") : []);
const num = (value: unknown): number => Number(value);
const finite = (value: unknown): boolean => Number.isFinite(Number(value));
const text = (value: unknown): string => String(value ?? "").trim();
/** 字幕归一：去空白与标点，只比字 */
const normText = (value: unknown): string => text(value).replace(/[\s，。！？、,.!?…“”"'「」『』:：;；—\-~·]/g, "");
/** 两句字幕的字重合率（按较短一句算） */
function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const set = new Set(Array.from(b));
  const common = Array.from(a).filter((ch) => set.has(ch)).length;
  return common / Math.max(1, Math.min(a.length, b.length));
}

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
  span: { startSec: number; endSec: number },
  dupAnyTime?: (a: Row, b: Row) => boolean,
): { added: Row[]; dropped: number } {
  const added: Row[] = [];
  let dropped = 0;
  const seen = [...base];
  for (const row of candidates) {
    const at = num(row.atSec);
    // 0907 实弹：第 2 稿一条 atSec=297 的字幕越出本片 0–293 秒，补进去后整集门禁判死——越界一律不补
    if (!finite(at) || at < span.startSec - RANGE_TOLERANCE_SEC || at > span.endSec + RANGE_TOLERANCE_SEC) { dropped += 1; continue; }
    const dup = seen.some((s) => (finite(s.atSec) && Math.abs(num(s.atSec) - at) <= windowSec && sameKind(s, row)) || (dupAnyTime?.(s, row) ?? false));
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
function addAudioCues(base: Row, candidates: Row[], span: { startSec: number; endSec: number }): { added: number; dropped: number } {
  const tracks = audioTracks(base);
  const existing = tracks.flatMap((t) => (Array.isArray(t.cues) ? (t.cues as Row[]) : []));
  let added = 0;
  let dropped = 0;
  for (const other of candidates) {
    for (const track of audioTracks(other)) {
      for (const cue of Array.isArray(track.cues) ? (track.cues as Row[]) : []) {
        const at = num(cue.atSec);
        if (!finite(at) || at < span.startSec - RANGE_TOLERANCE_SEC || at > span.endSec + RANGE_TOLERANCE_SEC) { dropped += 1; continue; }
        const dup = existing.some((c) => finite(c.atSec) && Math.abs(num(c.atSec) - at) <= AUDIO_CUE_WINDOW_SEC);
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
  const baseKm = rows(merged, "keyMoments");
  const kmAdd: { added: Row[]; dropped: number } = { added: [], dropped: 0 };
  const otherKm = others.flatMap((d) => rows(d.raw, "keyMoments")).filter((r) => finite(r.atSec)).sort((a, b) => num(a.atSec) - num(b.atSec));
  if (baseKm.length >= KEY_MOMENT_FLOOR) {
    kmAdd.dropped = otherKm.length;
  } else {
    const kept = [...baseKm];
    for (const row of otherKm) {
      if (kept.length >= KEY_MOMENT_FLOOR) { kmAdd.dropped += 1; continue; }
      const at = num(row.atSec);
      if (at < span.startSec - RANGE_TOLERANCE_SEC || at > span.endSec + RANGE_TOLERANCE_SEC) { kmAdd.dropped += 1; continue; }
      if (kept.some((k) => finite(k.atSec) && Math.abs(num(k.atSec) - at) < KEY_MOMENT_TOPUP_GAP_SEC)) { kmAdd.dropped += 1; continue; }
      kept.push(copy(row)); kmAdd.added.push(row);
    }
    if (kmAdd.added.length) merged.keyMoments = kept.sort((a, b) => num(a.atSec) - num(b.atSec));
  }
  const subAdd = addPoints(rows(merged, "subtitles"), others.flatMap((d) => rows(d.raw, "subtitles")), SUBTITLE_WINDOW_SEC,
    (a, b) => {
      const x = normText(a.textZh), y = normText(b.textZh);
      return x === y || textSimilarity(x, y) >= SUBTITLE_SIMILARITY;
    }, span, /* sameTextAnyTime */ (a, b) => normText(a.textZh) === normText(b.textZh) && normText(a.textZh).length >= 6);
  if (subAdd.added.length) merged.subtitles = [...rows(merged, "subtitles"), ...subAdd.added].sort((a, b) => num(a.atSec) - num(b.atSec));
  const cueAdd = addAudioCues(merged, others.map((d) => d.raw), span);

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
