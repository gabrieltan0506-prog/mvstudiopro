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
import {
  MUSIC_MV_BEAT_WINDOW_MIN_SEC,
  musicMvPacingAt,
  type MusicMvBeatGrid,
  type MusicMvShotBeat,
} from "./canvasMusicMv";

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
    // 节奏自适应：只有 beat 段吸附；phrase/free 段按乐句与能量切，不硬切网格
    if (musicMvPacingAt(grid, cut) !== "beat") continue;
    const snapped = nearestBeat(cut, grid);
    if (Math.abs(snapped - cut) < 0.0015 || Math.abs(snapped - cut) > grid.beatSec / 2 + 1e-6) continue;
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
      if (musicMvPacingAt(grid, t) !== "beat") continue;
      const snapped = nearestBeat(t, grid);
      if (Math.abs(snapped - t) <= grid.beatSec / 2 + 1e-6 && snapped > rows[i - 1]!.startSec + 0.25 && snapped < rows[i]!.endSec - 0.25) {
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

/**
 * 演唱段窗表 = 用户确认版歌词时间表（歌词按「对白」处理的秒锁真源）：
 * 每句唱词一窗（起止即该句起止，裁到镜头区间，lipSync=true，lyricZh=该句原文）；
 * 句间空隙 ≥0.5 秒成过门窗（lipSync=false），<0.5 秒并入前一窗作换气；
 * 各窗的动作/运镜/灯光/情绪/音效取顾问逐窗节拍里与之重叠最多的那一窗。
 */
export function singingWindowsFromLyricLines(
  shot: TimedShot,
  advisorBeats: readonly MusicMvShotBeat[],
  lines: ReadonlyArray<{ text: string; startSec: number; endSec: number }>,
): MusicMvShotBeat[] {
  if (!advisorBeats.length) throw new Error(`演唱镜 ${shot.id} 缺少逐窗节拍，请重新出分镜`);
  // 只取真歌词句对口型；吟唱句不对口型
  const inShot = lines
    .filter(l => (l as { kind?: string }).kind !== "chant")
    .map(l => ({ text: l.text.trim(), startSec: r3(Math.max(shot.startSec, l.startSec)), endSec: r3(Math.min(shot.endSec, l.endSec)) }))
    .filter(l => l.text && l.endSec - l.startSec > 0.05)
    .sort((a, b) => a.startSec - b.startSec);
  if (!inShot.length) throw new Error(`演唱镜 ${shot.id} 的区间里没有已确认的唱句，请先确认本段歌词或改为非演唱镜`);
  const contentFor = (a: number, b: number) => {
    let best = advisorBeats[0]!;
    let bestOverlap = -1;
    for (const w of advisorBeats) {
      const overlap = Math.min(b, w.endSec) - Math.max(a, w.startSec);
      if (overlap > bestOverlap) { bestOverlap = overlap; best = w; }
    }
    return best;
  };
  const out: MusicMvShotBeat[] = [];
  const push = (a: number, b: number, line?: { text: string }) => {
    const c = contentFor(a, b);
    out.push({
      startSec: r3(a), endSec: r3(b),
      actionZh: c.actionZh, cameraZh: c.cameraZh, lightingZh: c.lightingZh, moodZh: c.moodZh, sfxZh: c.sfxZh,
      lipSync: Boolean(line),
      ...(line ? { lyricZh: line.text } : {}),
    });
  };
  let cursor = shot.startSec;
  for (const line of inShot) {
    const start = Math.max(cursor, line.startSec);
    if (start - cursor >= MUSIC_MV_BEAT_WINDOW_MIN_SEC) push(cursor, start);
    else if (out.length) out[out.length - 1]!.endSec = r3(start);
    else if (start > cursor) { push(cursor, line.endSec, line); cursor = line.endSec; continue; }
    if (line.endSec > start) push(start, line.endSec, line);
    cursor = Math.max(cursor, line.endSec);
  }
  if (shot.endSec - cursor >= MUSIC_MV_BEAT_WINDOW_MIN_SEC) push(cursor, shot.endSec);
  else out[out.length - 1]!.endSec = r3(shot.endSec);
  return out;
}
