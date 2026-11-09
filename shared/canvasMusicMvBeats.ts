/**
 * MV 逐窗节拍 · 确定性修复层（1109）。
 *
 * 顾问（LLM）给出每镜 2–4 秒窗与五项内容；这里只做「时间」修复，不改写任何内容字段：
 *  - 剪点吸附：非演唱镜之间的剪点吸附到最近拍点（≤ 半拍）；与演唱镜相邻的剪点不动——
 *    演唱镜按原歌绝对时间帧精确落位，口型才对得上（与数字人克隆声对白秒锁同理）。
 *  - 窗界修复：裁到镜头区间、首尾补齐、相邻窗无缝衔接、窗界吸附到拍点（演唱镜不吸附）、
 *    不足 0.5 秒的窗并入相邻窗；超长窗不拆（拆分会伪造内容），交校验层带原因重写。
 * 所有修复返回 fixes 清单，由调用方落永久证据。
 */
import { COMPILER_ENGINE_LIMITS, type CompilerEngineId } from "./manhuaShotIR";
import {
  MUSIC_MV_BEAT_WINDOW_MAX_SEC,
  MUSIC_MV_BEAT_WINDOW_MIN_SEC,
  musicMvPacingAt,
  type MusicMvBeatGrid,
  type MusicMvShotBeat,
} from "./canvasMusicMv";

/** phrase 段拍点微调上限（秒）。 */
export const PHRASE_MICRO_SNAP_SEC = 0.12;
type Grid = Pick<MusicMvBeatGrid, "beatSec" | "phaseSec"> & Partial<Pick<MusicMvBeatGrid, "segments">>;

export type BeatFix = { shotId: string; action: string; before: unknown; after: unknown; reasonZh: string };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** 由网格推出区间内全部拍点（歌曲绝对秒）。 */
export function beatsInRange(grid: Pick<MusicMvBeatGrid, "beatSec" | "phaseSec">, fromSec: number, toSec: number): number[] {
  const out: number[] = [];
  if (!(grid.beatSec > 0)) return out;
  const k0 = Math.ceil((fromSec - grid.phaseSec) / grid.beatSec - 1e-9);
  for (let k = Math.max(0, k0); ; k += 1) {
    const t = grid.phaseSec + k * grid.beatSec;
    if (t > toSec + 1e-9) break;
    out.push(r3(t));
  }
  return out;
}

function nearestBeat(t: number, grid: Pick<MusicMvBeatGrid, "beatSec" | "phaseSec">): number {
  const k = Math.max(0, Math.round((t - grid.phaseSec) / grid.beatSec));
  return r3(grid.phaseSec + k * grid.beatSec);
}

type TimedShot = { id: string; startSec: number; endSec: number; kind?: string };

/**
 * 剪点吸附到拍点。首尾（0 与歌曲终点）不动；任一侧是演唱镜或素材切片时不动。
 * 吸附后每镜仍须 ≥ minShotSec，否则保留原剪点。
 */
export function snapShotCutsToBeats<T extends TimedShot>(
  shots: readonly T[],
  grid: Grid,
  minShotSec = 0.5,
): { shots: T[]; fixes: BeatFix[] } {
  const out = shots.map(s => ({ ...s }));
  const fixes: BeatFix[] = [];
  for (let i = 1; i < out.length; i += 1) {
    const prev = out[i - 1]!;
    const next = out[i]!;
    if (prev.kind === "singing" || next.kind === "singing" || prev.kind === "footage" || next.kind === "footage") continue;
    const cut = next.startSec;
    // 节奏自适应：beat 段吸附到 ≤半拍内的拍点；phrase 段按乐句与能量切，拍点只作 ≤0.12 秒的微调；free 段不动
    const pacing = musicMvPacingAt(grid, cut);
    if (pacing === "free") continue;
    const snapped = nearestBeat(cut, grid);
    const reach = pacing === "beat" ? grid.beatSec / 2 : PHRASE_MICRO_SNAP_SEC;
    if (Math.abs(snapped - cut) < 0.0015 || Math.abs(snapped - cut) > reach + 1e-6) continue;
    if (snapped - prev.startSec < minShotSec || next.endSec - snapped < minShotSec) continue;
    fixes.push({ shotId: next.id, action: "snap_cut", before: cut, after: snapped, reasonZh: `剪点 ${cut} 秒吸附到拍点 ${snapped} 秒` });
    prev.endSec = snapped;
    next.startSec = snapped;
    // 镜内窗随剪点同步首尾
    for (const [s, edge] of [[prev, "end"], [next, "start"]] as const) {
      const beats = (s as { beats?: MusicMvShotBeat[] }).beats;
      if (!beats?.length) continue;
      const copy = beats.map(w => ({ ...w }));
      if (edge === "end") copy[copy.length - 1]!.endSec = snapped;
      else copy[0]!.startSec = snapped;
      (s as { beats?: MusicMvShotBeat[] }).beats = copy;
    }
  }
  return { shots: out, fixes };
}

/**
 * 单镜窗界修复（只动时间）。演唱镜窗界不吸附拍点（跟唱句走），其余吸附到 ≤ 半拍内的拍点。
 */
export function repairShotBeatWindows(
  shot: TimedShot,
  raw: readonly MusicMvShotBeat[],
  grid?: Grid,
): { beats: MusicMvShotBeat[]; fixes: BeatFix[] } {
  const fixes: BeatFix[] = [];
  const before = raw.map(w => [w.startSec, w.endSec]);
  let rows = raw
    .map(w => ({ ...w, startSec: Math.max(shot.startSec, w.startSec), endSec: Math.min(shot.endSec, w.endSec) }))
    .filter(w => w.endSec - w.startSec > 0.01)
    .sort((a, b) => a.startSec - b.startSec);
  if (!rows.length) return { beats: [], fixes };
  // 无缝衔接：首窗起点 = 镜头起点，相邻窗以前窗终点为界，末窗终点 = 镜头终点
  rows[0]!.startSec = shot.startSec;
  for (let i = 1; i < rows.length; i += 1) {
    const mid = rows[i]!.startSec;
    rows[i - 1]!.endSec = mid;
  }
  rows[rows.length - 1]!.endSec = shot.endSec;
  // 窗界吸附（非演唱镜）
  if (grid && shot.kind !== "singing") {
    for (let i = 1; i < rows.length; i += 1) {
      const t = rows[i]!.startSec;
      const pacing = musicMvPacingAt(grid, t);
      if (pacing === "free") continue;
      const snapped = nearestBeat(t, grid);
      if (Math.abs(snapped - t) <= (pacing === "beat" ? grid.beatSec / 2 : PHRASE_MICRO_SNAP_SEC) + 1e-6 && snapped > rows[i - 1]!.startSec + 0.25 && snapped < rows[i]!.endSec - 0.25) {
        rows[i - 1]!.endSec = snapped;
        rows[i]!.startSec = snapped;
      }
    }
  }
  // 过短窗并入相邻窗（内容拼接，不丢）
  const merged: MusicMvShotBeat[] = [];
  for (const w of rows) {
    const len = w.endSec - w.startSec;
    const last = merged[merged.length - 1];
    if (len + 1e-9 < MUSIC_MV_BEAT_WINDOW_MIN_SEC && last) {
      last.endSec = w.endSec;
      fixes.push({ shotId: shot.id, action: "merge_window", before: [w.startSec, w.endSec], after: [last.startSec, last.endSec], reasonZh: `窗不足 ${MUSIC_MV_BEAT_WINDOW_MIN_SEC} 秒，并入前窗` });
      continue;
    }
    merged.push({ ...w });
  }
  if (merged.length > 1 && merged[0]!.endSec - merged[0]!.startSec + 1e-9 < MUSIC_MV_BEAT_WINDOW_MIN_SEC) {
    const first = merged.shift()!;
    merged[0]!.startSec = first.startSec;
    fixes.push({ shotId: shot.id, action: "merge_window", before: [first.startSec, first.endSec], after: [merged[0]!.startSec, merged[0]!.endSec], reasonZh: "首窗过短，并入后窗" });
  }
  const beats = merged.map(w => ({ ...w, startSec: r3(w.startSec), endSec: r3(w.endSec) }));
  const after = beats.map(w => [w.startSec, w.endSec]);
  if (JSON.stringify(before) !== JSON.stringify(after))
    fixes.push({ shotId: shot.id, action: "windows", before, after, reasonZh: "窗界裁到镜头区间、无缝衔接并吸附拍点" });
  return { beats, fixes };
}

/**
 * 演唱镜落位核对：高光切片里每个演唱镜在成片时间线上的起点，必须等于其原歌绝对时间减去高光起点（≤ 1 帧）。
 * rows 为 musicMvShotSlices 的输出（顺序即成片顺序）。返回每个演唱镜的误差（秒）。
 */
export function musicMvSingingPlacement(
  rows: ReadonlyArray<{ shot: { id: string; startSec: number; kind?: string }; offsetSec: number; durationSec: number }>,
  rangeStartSec = 0,
): Array<{ shotId: string; timelineStartSec: number; songStartSec: number; errorSec: number }> {
  let cursor = 0;
  const out: Array<{ shotId: string; timelineStartSec: number; songStartSec: number; errorSec: number }> = [];
  for (const row of rows) {
    if (row.shot.kind === "singing") {
      const songStartSec = row.shot.startSec + row.offsetSec;
      out.push({ shotId: row.shot.id, timelineStartSec: r3(cursor), songStartSec: r3(songStartSec), errorSec: r3(Math.abs(cursor - (songStartSec - rangeStartSec))) });
    }
    cursor += row.durationSec;
  }
  return out;
}

/** 唱句窗前后呼吸上限（秒）：唱句窗只覆盖唱句本身 + 前后 ≤0.3 秒换气。 */
export const MUSIC_MV_SINGING_BREATH_SEC = 0.3;

/**
 * 演唱段窗表 = 用户确认版歌词时间表（歌词按「对白」处理的秒锁真源）：
 * - 每句唱词一窗（lipSync=true，lyricZh=该句原文），窗界按 0.1 秒向外取整（起点向下、终点向上，不切掉唱句），裁到镜头区间；
 * - 唱句之外的纯音乐（首句前引子、句间间奏、末句后尾奏）≥0.5 秒时单独成窗（lipSync=false），不并进唱句窗；
 *   超过单窗上限（min(逐窗上限 6 秒, 所选模型单段上限)）的引子/间奏按等长切成多窗；
 * - <0.5 秒的空隙作换气并进相邻唱句窗：句间空隙两句平分（每侧 ≤0.25 秒），引子/尾奏并进首/末句（≤0.3 秒；
 *   0.3–0.5 秒的边缘空隙因不足一窗只能并入，属唯一例外）；
 * - 窗界一位小数；首窗起点/末窗终点即镜头起止（与镜头无缝）；
 * - 各窗的动作/运镜/灯光/情绪/音效取顾问逐窗节拍里与之重叠最多的那一窗。
 */
export function singingWindowsFromLyricLines(
  shot: TimedShot,
  advisorBeats: readonly MusicMvShotBeat[],
  lines: ReadonlyArray<{ text: string; startSec: number; endSec: number }>,
  opts: { engine?: CompilerEngineId; maxWindowSec?: number } = {},
): MusicMvShotBeat[] {
  if (!advisorBeats.length) throw new Error(`演唱镜 ${shot.id} 缺少逐窗节拍，请重新出分镜`);
  const cap = Math.min(
    MUSIC_MV_BEAT_WINDOW_MAX_SEC,
    opts.engine ? COMPILER_ENGINE_LIMITS[opts.engine].maxSegmentSec : Infinity,
    opts.maxWindowSec ?? Infinity,
  );
  const r1 = (n: number) => Math.round(n * 10 + 1e-6) / 10;
  const floor1 = (n: number) => Math.floor(n * 10 + 1e-6) / 10;
  const ceil1 = (n: number) => Math.ceil(n * 10 - 1e-6) / 10;
  const s0 = r3(shot.startSec);
  const s1 = r3(shot.endSec);
  // 只取真歌词句对口型；吟唱句不对口型（落成纯音乐窗）
  const spans: Array<{ text: string; startSec: number; endSec: number }> = [];
  for (const l of lines
    .filter(l => (l as { kind?: string }).kind !== "chant" && l.text.trim())
    .map(l => ({ text: l.text.trim(), startSec: Math.max(s0, floor1(l.startSec)), endSec: Math.min(s1, ceil1(l.endSec)) }))
    .sort((a, b) => a.startSec - b.startSec)) {
    const prev = spans[spans.length - 1];
    const startSec = prev ? Math.max(prev.endSec, l.startSec) : l.startSec;
    if (l.endSec - startSec > 0.05) spans.push({ ...l, startSec });
  }
  if (!spans.length) throw new Error(`演唱镜 ${shot.id} 的区间里没有已确认的唱句，请先确认本段歌词或改为非演唱镜`);
  const contentFor = (a: number, b: number) => {
    let best = advisorBeats[0]!;
    let bestOverlap = -Infinity;
    for (const w of advisorBeats) {
      const overlap = Math.min(b, w.endSec) - Math.max(a, w.startSec);
      if (overlap > bestOverlap) { bestOverlap = overlap; best = w; }
    }
    return best;
  };
  // 先定唱句窗界（含换气），再把剩下的纯音乐空隙切成独立窗
  const sung = spans.map(s => ({ ...s, a: s.startSec, b: s.endSec }));
  // 不足一窗的唱句（多见于镜头切在句尾/句首）向相邻纯音乐借换气补足 0.5 秒：每侧 ≤0.3 秒，且借后空隙仍 ≥0.5 秒或借空
  sung.forEach((s, i) => {
    const borrow = (room: number, need: number) => Math.max(0, Math.min(MUSIC_MV_SINGING_BREATH_SEC, need, room));
    let need = MUSIC_MV_BEAT_WINDOW_MIN_SEC - (s.b - s.a);
    if (need <= 1e-9) return;
    const before = s.a - (i === 0 ? s0 : sung[i - 1]!.b);
    const takeA = borrow(before < MUSIC_MV_BEAT_WINDOW_MIN_SEC ? before : before - MUSIC_MV_BEAT_WINDOW_MIN_SEC, need);
    s.a = Math.max(i === 0 ? s0 : sung[i - 1]!.b, floor1(s.a - takeA));
    need = MUSIC_MV_BEAT_WINDOW_MIN_SEC - (s.b - s.a);
    if (need <= 1e-9) return;
    const after = (i === sung.length - 1 ? s1 : sung[i + 1]!.a) - s.b;
    const takeB = borrow(after < MUSIC_MV_BEAT_WINDOW_MIN_SEC ? after : after - MUSIC_MV_BEAT_WINDOW_MIN_SEC, need);
    s.b = Math.min(i === sung.length - 1 ? s1 : sung[i + 1]!.a, ceil1(s.b + takeB));
  });
  const gaps: Array<[number, number]> = [];
  for (let i = 0; i <= sung.length; i += 1) {
    const a = i === 0 ? s0 : sung[i - 1]!.b;
    const b = i === sung.length ? s1 : sung[i]!.a;
    const g = b - a;
    if (g < 1e-6) continue;
    if (g + 1e-9 >= MUSIC_MV_BEAT_WINDOW_MIN_SEC) { gaps.push([a, b]); continue; }
    // 换气：句间平分，边缘并入唯一相邻唱句
    if (i === 0) sung[0]!.a = s0;
    else if (i === sung.length) sung[i - 1]!.b = s1;
    else {
      const mid = Math.min(b, Math.max(a, r1((a + b) / 2)));
      sung[i - 1]!.b = mid;
      sung[i]!.a = mid;
    }
  }
  type Row = { a: number; b: number; line?: { text: string } };
  const rows: Row[] = sung.map(s => ({ a: s.a, b: s.b, line: s }));
  for (const [a, b] of gaps) {
    const parts = Math.max(1, Math.ceil((b - a) / cap - 1e-9));
    for (let k = 0; k < parts; k += 1) {
      const pa = k === 0 ? a : r1(a + ((b - a) * k) / parts);
      const pb = k === parts - 1 ? b : r1(a + ((b - a) * (k + 1)) / parts);
      rows.push({ a: pa, b: pb });
    }
  }
  rows.sort((x, y) => x.a - y.a);
  return rows.map(({ a, b, line }) => {
    const c = contentFor(a, b);
    return {
      startSec: r3(a), endSec: r3(b),
      actionZh: c.actionZh, cameraZh: c.cameraZh, lightingZh: c.lightingZh, moodZh: c.moodZh, sfxZh: c.sfxZh,
      lipSync: Boolean(line),
      ...(line ? { lyricZh: line.text } : {}),
    };
  });
}
