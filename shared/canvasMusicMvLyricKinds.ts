/**
 * 1109 歌词句类型与镜头分工：
 * - lyric（真歌词）→ 演唱段：{} 对白秒锁、按原歌绝对时间帧精确落位；
 * - chant（吟唱：重复短词、无语义、拖长元音）→ 素材填充段：不对口型，由顾问逐窗给素材建议；
 * 自动识别只给建议，用户在歌词表里可改；也可在某秒把之后全部设为吟唱（跨该秒的句子切开）。
 * 高光首尾淡入淡出：淡出起点对齐最后一拍/乐句尾，不切在半句半拍；高光起点落在句中才做短淡入。
 */
import type { MusicMvBeatGrid, MusicMvLyricLine } from "./canvasMusicMv";

const INTERJECTION = /^[啊哦噢喔嗯呜呜啦咿呀嘿诶哎唔哈呐嘞喂哟吔～~\s,，。!！?？…·-]+$/;
const LATIN_VOCABLE = /^(?:\s*(?:oh|ah|la|na|da|ooh|aah|hey|yeah|uh|mm|hm|whoa|wo|yo)\b[\s,!.~-]*)+$/i;

/** 吟唱建议：拖长音/语气词、全句只有一两个字反复、同一词组整句重复。 */
export function suggestLyricLineKind(text: string): "lyric" | "chant" {
  const t = text.trim();
  if (!t) return "chant";
  if (INTERJECTION.test(t) || LATIN_VOCABLE.test(t) || /[～~]{1,}|(.)\1{3,}/.test(t)) return "chant";
  const tokens = t.split(/[\s,，、]+/).filter(Boolean);
  if (tokens.length >= 2 && new Set(tokens).size === 1) return "chant";
  const chars = Array.from(t.replace(/[\s,，、。!！?？…·-]/g, ""));
  const distinct = new Set(chars);
  if (chars.length >= 4 && distinct.size <= 2) return "chant";
  // 大半是同一个词组反复（如「姿势 姿势 姿势」「上升上升」）
  const word = tokens.length ? tokens[tokens.length - 1]! : t;
  if (word.length >= 2 && t.split(word).length - 1 >= 2 && t.replace(new RegExp(word, "g"), "").replace(/[\s\w]/g, "").length <= 2) return "chant";
  return "lyric";
}

export function lyricLineKind(l: MusicMvLyricLine): "lyric" | "chant" {
  return l.kind ?? "lyric";
}

/** 自动建议句类型（用户已标过的不动）。 */
export function withSuggestedLyricKinds(lines: readonly MusicMvLyricLine[]): MusicMvLyricLine[] {
  return lines.map(l => (l.kind ? l : { ...l, kind: suggestLyricLineKind(l.text) }));
}

/** 从 atSec 起全部设为吟唱：跨 atSec 的句子在 atSec 切开（前半保留原类型、后半为吟唱）。 */
export function markChantFrom(lines: readonly MusicMvLyricLine[], atSec: number): MusicMvLyricLine[] {
  const out: MusicMvLyricLine[] = [];
  const r2 = (n: number) => Math.round(n * 100) / 100;
  for (const l of lines) {
    if (l.endSec <= atSec + 1e-6) out.push({ ...l, kind: l.kind ?? suggestLyricLineKind(l.text) });
    else if (l.startSec >= atSec - 1e-6) out.push({ ...l, kind: "chant" });
    else {
      out.push({ ...l, endSec: r2(atSec), kind: l.kind === "chant" ? "chant" : "lyric" });
      out.push({ ...l, startSec: r2(atSec), kind: "chant" });
    }
  }
  return out;
}

function coverage(lines: readonly MusicMvLyricLine[], kind: "lyric" | "chant", a: number, b: number) {
  return lines.filter(l => lyricLineKind(l) === kind).reduce((s, l) => s + Math.max(0, Math.min(b, l.endSec) - Math.max(a, l.startSec)), 0);
}

type PlanShot = { id: string; startSec: number; endSec: number; kind?: "generated" | "singing" | "footage"; referenceIndices: number[]; [k: string]: unknown };

/**
 * 按句类型给高光内镜头分工：镜头内出现「真歌词 → 吟唱」交界（吟唱区起点）时在交界处切开（两边都 ≥ minPartSec），
 * 真歌词覆盖过半且 ≥4 秒 → 演唱段；吟唱覆盖过半 → 素材填充段（fillRequested）；其余保持原样。素材段不动。
 */
export function partitionShotsByLyricKind<T extends PlanShot>(
  shots: readonly T[],
  lines: readonly MusicMvLyricLine[],
  range: { startSec: number; endSec: number },
  minPartSec = 2,
): { shots: T[]; changes: Array<{ id: string; action: string; detailZh: string }> } {
  const changes: Array<{ id: string; action: string; detailZh: string }> = [];
  const chantStarts = lines.filter((l, i) => lyricLineKind(l) === "chant" && (i === 0 || lyricLineKind(lines[i - 1]!) === "lyric")).map(l => l.startSec);
  const lyricStarts = lines.filter((l, i) => lyricLineKind(l) === "lyric" && i > 0 && lyricLineKind(lines[i - 1]!) === "chant").map(l => l.startSec);
  // 吟唱区：从某个吟唱起点到下一个真歌词起点（或歌曲结束）——区内没听写出字的地方也按吟唱
  const transitions = [...chantStarts.map(t => ({ t, chant: true })), ...lyricStarts.map(t => ({ t, chant: false }))].sort((a, b) => a.t - b.t);
  const inChantZone = (t: number) => {
    let zone = false;
    for (const x of transitions) if (x.t <= t + 1e-6) zone = x.chant;
    return zone;
  };
  const out: T[] = [];
  for (const shot of shots) {
    if (shot.kind === "footage" || shot.endSec <= range.startSec || shot.startSec >= range.endSec) { out.push(shot); continue; }
    const cutAt = [...chantStarts, ...lyricStarts].filter(t => t - shot.startSec >= minPartSec && shot.endSec - t >= minPartSec).sort((a, b) => a - b);
    const bounds = [shot.startSec, ...cutAt, shot.endSec];
    const parts = bounds.slice(1).map((end, i) => ({ start: bounds[i]!, end }));
    parts.forEach((p, i) => {
      const len = p.end - p.start;
      const lyric = coverage(lines, "lyric", p.start, p.end) / len;
      const chant = coverage(lines, "chant", p.start, p.end) / len;
      const id = parts.length > 1 ? `${shot.id}${String.fromCharCode(97 + i)}` : shot.id;
      const base = { ...shot, id, startSec: p.start, endSec: p.end } as T;
      if (lyric >= 0.5 && len >= 4) {
        out.push({ ...base, kind: "singing", referenceIndices: shot.referenceIndices.length ? shot.referenceIndices : [0], fillRequested: undefined } as T);
        changes.push({ id, action: "singing", detailZh: `${p.start}–${p.end} 秒真歌词覆盖 ${(lyric * 100).toFixed(0)}%，按演唱段（对口型）做` });
      } else if (chant >= 0.5 || (chant > 0 && lyric < 0.5) || inChantZone((p.start + p.end) / 2)) {
        out.push({ ...base, kind: "generated", fillRequested: true } as T);
        changes.push({ id, action: "fill", detailZh: `${p.start}–${p.end} 秒吟唱覆盖 ${(chant * 100).toFixed(0)}%，按素材填充段做（不对口型）` });
      } else {
        out.push(base);
        if (parts.length > 1) changes.push({ id, action: "split", detailZh: `${p.start}–${p.end} 秒保持原制作方式` });
      }
    });
  }
  // 清掉未定义字段（schema strict）
  return { shots: out.map(s => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as T), changes };
}

/**
 * 高光淡入/淡出（音画同步）：淡出默认 2–3 秒，起点取 [终点−3, 终点−2] 内离「终点−目标」最近的拍点或句尾；
 * 用户给了 fadeOutSec 就按用户的。高光起点落在句中（某句跨起点）才做短淡入（默认 0.4 秒）。
 */
export function planMvHighlightFades(input: {
  range: { startSec: number; endSec: number };
  lines?: readonly MusicMvLyricLine[];
  beatGrid?: Pick<MusicMvBeatGrid, "beatSec" | "phaseSec">;
  fadeInSec?: number;
  fadeOutSec?: number;
}): { fadeInSec: number; fadeOutSec: number; fadeOutStartSec: number; reasonZh: string } {
  const { range } = input;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  let fadeOutSec: number;
  let reason: string;
  if (input.fadeOutSec !== undefined) { fadeOutSec = input.fadeOutSec; reason = "用户设定淡出时长"; }
  else {
    const target = 2.5;
    const cands: Array<{ t: number; why: string }> = [];
    if (input.beatGrid?.beatSec) {
      const g = input.beatGrid;
      for (let k = Math.ceil((range.endSec - 3 - g.phaseSec) / g.beatSec); g.phaseSec + k * g.beatSec <= range.endSec - 2 + 1e-9; k++) cands.push({ t: g.phaseSec + k * g.beatSec, why: "拍点" });
    }
    for (const l of input.lines ?? []) if (l.endSec >= range.endSec - 3 && l.endSec <= range.endSec - 2) cands.push({ t: l.endSec, why: "句尾" });
    const pick = cands.sort((a, b) => Math.abs(range.endSec - a.t - target) - Math.abs(range.endSec - b.t - target))[0];
    fadeOutSec = pick ? range.endSec - pick.t : target;
    reason = pick ? `淡出起点对齐${pick.why}` : "无拍点/句尾可对齐，按默认 2.5 秒";
  }
  const straddle = (input.lines ?? []).some(l => l.startSec < range.startSec - 0.05 && l.endSec > range.startSec + 0.05);
  const fadeInSec = input.fadeInSec ?? (straddle ? 0.4 : 0);
  return { fadeInSec: r3(fadeInSec), fadeOutSec: r3(fadeOutSec), fadeOutStartSec: r3(range.endSec - fadeOutSec), reasonZh: `${reason}${fadeInSec > 0 ? "；起点落在句中，做短淡入" : ""}` };
}
