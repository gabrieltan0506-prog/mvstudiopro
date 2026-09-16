/**
 * 运镜调度生成器（0916）：把一段可拍表（对白 + 出场人物 + 节奏档）变成镜表——
 * 对白戏按「过肩公式」出镜（谁在前景/过谁肩/拍谁脸 → 景别推情绪 → 关键句反应镜），
 * 动作戏交给 manhuaCameraGrammar（接触点切镜），混合段最后一句台词直接切起手。
 *
 * 规则真源：知识库《漫剧工厂/0916-过肩镜头与对话运镜调度》+ 技能 fight-camera-grammar 第七节。
 * 纯函数、不碰网络；导演版分镜（manhuaStoryDistill）与白模相机（manhuaPrevisFromActionPlan）共用。
 */
import { extractManhuaDialogueSpeakerName, extractManhuaSegmentDialogueQuotes } from "./manhuaEpisodeSegmentPlan.js";

export type ManhuaScheduledShotKind = "establish" | "ots" | "single" | "reaction";
export type ManhuaScheduledScale = "ws" | "ms" | "mcu" | "cu";

export type ManhuaScheduledShot = {
  index: number;
  kind: ManhuaScheduledShotKind;
  startSec: number;
  endSec: number;
  /** 拍谁的脸（建立镜为空） */
  faceZh: string;
  /** 过谁的肩（只有 ots 有） */
  overZh?: string;
  scale: ManhuaScheduledScale;
  height: "low" | "eye" | "high";
  /** 对应第几句台词（0 起；建立/反应镜无） */
  lineIndex?: number;
  /** 本镜覆盖的原对白行号，合镜仍保留顺序与次数。 */
  lineIndices?: number[];
  noteZh: string;
  /** 给静帧/成片提示词的一句「看得见的画面」 */
  promptZh: string;
};

export type ManhuaShotScheduleInput = {
  durationSec: number;
  /** 可拍表「对白」原文（含说话人：「甲：「…」」），或直接给 lines */
  dialogueZh?: string;
  lines?: Array<{ speakerZh: string; textZh: string }>;
  tempoTier?: "fast" | "slow" | "neutral";
  /** 本段有接触事件（动作戏）：对白只排到最后一句，之后交给动作文法 */
  hasContact?: boolean;
  /** 关键句（递刀/亮刀）的行号；省略 = 感叹/疑问最多的一句，都没有则最后一句 */
  keyLineIndex?: number;
  /** 混合段：对白必须在这个秒数前排完，之后交给动作文法；省略 = 段长 60% */
  dialogueEndSec?: number;
  /** 非人角色名（马/兽）：反应镜/过肩看它时用长焦看头 */
  nonHumanNames?: string[];
};

export type ManhuaShotSchedule = {
  shots: ManhuaScheduledShot[];
  /** 「A在画左、B在画右」——三不许之一：不改左右关系 */
  layoutZh: string;
  speakersZh: string[];
  keyLineIndex: number;
  notesZh: string[];
};

const FPS = 24;
const fr = (s: number) => Math.round(s * FPS) / FPS;

const TEMPO = {
  fast: { establishSec: 1.0, minLineSec: 1.0, reactionSec: 1.0, maxCuts: 8 },
  neutral: { establishSec: 1.5, minLineSec: 1.5, reactionSec: 1.5, maxCuts: 6 },
  slow: { establishSec: 2.5, minLineSec: 2.5, reactionSec: 2.0, maxCuts: 5 },
} as const;

export const MANHUA_SCALE_LABEL_ZH: Record<ManhuaScheduledScale, string> = { ws: "全景", ms: "中景", mcu: "中近景", cu: "特写" };

function stripQuote(line: string): string {
  return line
    .replace(/^([一-鿿·A-Za-z]{2,12})(?:[（(][^）)]{0,16}[）)])?\s*[：:]\s*/, "")
    .replace(/^[「『"“]|[」』"”]$/g, "")
    .trim();
}

export function parseManhuaDialogueLines(dialogueZh: string | null | undefined): Array<{ speakerZh: string; textZh: string }> {
  return extractManhuaSegmentDialogueQuotes(String(dialogueZh || "")).map((line) => ({
    speakerZh: extractManhuaDialogueSpeakerName(line) || "",
    textZh: stripQuote(line),
  }));
}

function bump(scale: ManhuaScheduledScale): ManhuaScheduledScale {
  return scale === "ws" ? "ms" : scale === "ms" ? "mcu" : "cu";
}

function pickKeyLine(lines: Array<{ textZh: string }>): number {
  if (!lines.length) return -1;
  let best = lines.length - 1;
  let bestScore = -1;
  lines.forEach((l, i) => {
    const score = (l.textZh.match(/[！!？?]/g) || []).length;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return bestScore > 0 ? best : lines.length - 1;
}

export function scheduleManhuaSegmentShots(input: ManhuaShotScheduleInput): ManhuaShotSchedule {
  const fullD = Math.max(1, input.durationSec);
  const D = input.hasContact ? Math.max(1, Math.min(fullD, input.dialogueEndSec ?? fullD * 0.6)) : fullD;
  const tempo = TEMPO[input.tempoTier ?? "neutral"];
  const nonHuman = new Set((input.nonHumanNames || []).map((s) => s.trim()).filter(Boolean));
  const rawLines = (input.lines ?? parseManhuaDialogueLines(input.dialogueZh)).map((l) => ({ speakerZh: l.speakerZh.trim(), textZh: l.textZh.trim() })).filter((l) => l.textZh);
  const notesZh: string[] = [];

  // 说话人按首次出现定左右：A 画左，B 画右；第三人以后不参与过肩轴线
  const speakersZh: string[] = [];
  for (const l of rawLines) if (l.speakerZh && !speakersZh.includes(l.speakerZh)) speakersZh.push(l.speakerZh);
  const A = speakersZh[0] || "";
  const B = speakersZh[1] || "";
  const layoutZh = A && B ? `${A}在画左、${B}在画右，机位不越轴，${A}看画右${B}看画左${speakersZh.length > 2 ? `；${speakersZh.slice(2).join("、")}不参与过肩轴线，单人出镜` : ""}` : A ? `${A}单人，机位不越轴` : "无对白";

  if (!rawLines.length) {
    return {
      shots: input.hasContact
        ? []
        : [{ index: 1, kind: "establish", startSec: 0, endSec: fr(fullD), faceZh: "", scale: "ws", height: "eye", noteZh: "无对白无接触：建立全景", promptZh: "全景建立空间纵深与人物站位" }],
      layoutZh,
      speakersZh,
      keyLineIndex: -1,
      notesZh: [input.hasContact ? "本段无对白，运镜交给动作文法" : "本段无对白无接触，只出建立镜"],
    };
  }

  const keyLineIndex = input.keyLineIndex != null && input.keyLineIndex >= 0 && input.keyLineIndex < rawLines.length ? input.keyLineIndex : pickKeyLine(rawLines);

  // 合并同一人连说的台词为一镜（景别推一档）
  type Group = { speakerZh: string; texts: string[]; lineStart: number; lineEnd: number; chars: number };
  const groups: Group[] = [];
  rawLines.forEach((l, i) => {
    const prev = groups[groups.length - 1];
    if (prev && prev.speakerZh === l.speakerZh && l.speakerZh) {
      prev.texts.push(l.textZh);
      prev.lineEnd = i;
      prev.chars += l.textZh.length;
    } else groups.push({ speakerZh: l.speakerZh, texts: [l.textZh], lineStart: i, lineEnd: i, chars: l.textZh.length });
  });

  // 时间分配：建立镜（≥2 人且段够长）+ 反应镜固定，其余按字数加权、不低于每镜最短
  const wantEstablish = speakersZh.length >= 2 && D >= 6 && !input.hasContact ? tempo.establishSec : speakersZh.length >= 2 && D >= 6 ? Math.min(tempo.establishSec, 1.0) : 0;
  const keyGroup = groups.findIndex((g) => keyLineIndex >= g.lineStart && keyLineIndex <= g.lineEnd);
  const listenerOfKey = (() => {
    const s = groups[keyGroup]?.speakerZh || A;
    return s === A ? B : A;
  })();
  const wantReaction = listenerOfKey ? tempo.reactionSec : 0;
  let lineBudget = D - wantEstablish - wantReaction;
  const minTotal = groups.length * tempo.minLineSec;
  let establishSec = wantEstablish;
  let reactionSec = wantReaction;
  if (lineBudget < minTotal) {
    // 段太短：先砍反应再砍建立，台词镜保底
    const deficit = minTotal - lineBudget;
    const cutR = Math.min(reactionSec, deficit);
    reactionSec -= cutR;
    const cutE = Math.min(establishSec, deficit - cutR);
    establishSec -= cutE;
    lineBudget = D - establishSec - reactionSec;
    if (lineBudget < minTotal) notesZh.push(`台词 ${rawLines.length} 句撑不进 ${D}s，每镜已压到下限`);
  }
  const totalChars = groups.reduce((n, g) => n + g.chars, 0) || 1;
  const rawSecs = groups.map((g) => Math.max(tempo.minLineSec, (lineBudget * g.chars) / totalChars));
  const rawSum = rawSecs.reduce((a, b) => a + b, 0) || 1;
  const lineSecs = rawSecs.map((s) => (s * lineBudget) / rawSum);

  const shots: ManhuaScheduledShot[] = [];
  let t = 0;
  const push = (s: Omit<ManhuaScheduledShot, "index" | "startSec" | "endSec">, sec: number) => {
    const start = fr(t);
    const end = fr(Math.min(D, t + sec));
    if (end - start < 1 / FPS) return;
    shots.push({ index: shots.length + 1, startSec: start, endSec: end, ...s });
    t = end;
  };

  if (establishSec > 0) {
    push({ kind: "establish", faceZh: "", scale: "ws", height: "eye", noteZh: `建立：${A}与${B}的相对位置`, promptZh: `双人全景建立：${A}在画左、${B}在画右，看清两人距离与空间纵深` }, establishSec);
  }

  let scale: ManhuaScheduledScale = "ms";
  let usedCleanSingle = false;
  let keySingleShot: ManhuaScheduledShot | null = null;
  groups.forEach((g, gi) => {
    const speaker = g.speakerZh || A;
    // 第三人以后不参与过肩轴线：只出单人镜，不过任何人的肩
    const listener = speaker === A ? B : speaker === B ? A : "";
    const isKey = gi === keyGroup;
    const multi = g.texts.length > 1;
    const thisScale: ManhuaScheduledScale = gi === 0 ? "ms" : multi ? bump(bump(scale)) : bump(scale);
    scale = thisScale;
    const quote = g.texts.join("／").slice(0, 40);
    const seesNonHuman = nonHuman.has(speaker);
    // ≥3 句后必须出现一次干净单人特写：落在关键句
    if (isKey && rawLines.length >= 3 && !usedCleanSingle) {
      usedCleanSingle = true;
      push({ kind: "single", faceZh: speaker, scale: "cu", height: "eye", lineIndex: g.lineStart, lineIndices: Array.from({ length: g.lineEnd - g.lineStart + 1 }, (_, i) => g.lineStart + i), noteZh: `${speaker} 关键句：干净单人特写`, promptZh: `${speaker}单人特写（不带前景肩），说「${quote}」，${MANHUA_SCALE_LABEL_ZH.cu}看表情起伏` }, lineSecs[gi]!);
      keySingleShot = shots[shots.length - 1] ?? null;
      return;
    }
    if (listener) {
      push({ kind: "ots", faceZh: speaker, overZh: listener, scale: thisScale, height: "eye", lineIndex: g.lineStart, lineIndices: Array.from({ length: g.lineEnd - g.lineStart + 1 }, (_, i) => g.lineStart + i), noteZh: `过${listener}肩看${speaker}${seesNonHuman ? "的头（非人角色，长焦）" : ""}`, promptZh: `过${listener}肩看${speaker}，${MANHUA_SCALE_LABEL_ZH[thisScale]}，${listener}的肩与后脑在画${listener === A ? "左" : "右"}失焦，${speaker}说「${quote}」时看向${listener}` }, lineSecs[gi]!);
    } else {
      push({ kind: "single", faceZh: speaker, scale: thisScale, height: "eye", lineIndex: g.lineStart, lineIndices: Array.from({ length: g.lineEnd - g.lineStart + 1 }, (_, i) => g.lineStart + i), noteZh: `${speaker} 单人`, promptZh: `${speaker}单人${MANHUA_SCALE_LABEL_ZH[thisScale]}，说「${quote}」` }, lineSecs[gi]!);
    }
  });

  if (reactionSec > 0 && listenerOfKey) {
    const keyText = rawLines[keyLineIndex]?.textZh.slice(0, 24) || "";
    push({ kind: "reaction", faceZh: listenerOfKey, scale: "cu", height: "eye", noteZh: `${listenerOfKey} 听到关键句的反应${nonHuman.has(listenerOfKey) ? "（非人角色：从人的肩后看它的头）" : ""}`, promptZh: `${listenerOfKey}反应特写：听到「${keyText}」后表情变化，停 ${reactionSec.toFixed(1)} 秒` }, reactionSec);
  }
  // 反应紧接关键句所在镜，而不是延迟到其他人的对白之后。
  const reactionIndex = shots.findIndex((s) => s.kind === "reaction");
  const keyIndex = shots.findIndex((s) => s.lineIndices?.includes(keyLineIndex));
  if (reactionIndex >= 0 && keyIndex >= 0 && reactionIndex !== keyIndex + 1) {
    const [reaction] = shots.splice(reactionIndex, 1);
    shots.splice(keyIndex + 1, 0, reaction!);
    let cursor = 0;
    for (const shot of shots) {
      const duration = shot.endSec - shot.startSec;
      shot.startSec = fr(cursor);
      shot.endSec = fr(cursor + duration);
      cursor = shot.endSec;
    }
  }
  // 末镜补到段尾（混合段：段尾交给动作文法，不补）
  if (shots.length && !input.hasContact && shots[shots.length - 1]!.endSec < D) shots[shots.length - 1]!.endSec = fr(D);

  // 切数上限：合并相邻同脸的过肩镜（保留景别更近的一档）
  while (shots.length > tempo.maxCuts) {
    let merged = false;
    for (let i = 1; i < shots.length; i += 1) {
      const p = shots[i - 1]!;
      const c = shots[i]!;
      if (p.kind === "ots" && c.kind === "ots" && p.faceZh === c.faceZh) {
        p.endSec = c.endSec;
        p.scale = bump(p.scale);
        p.lineIndices = [...(p.lineIndices || []), ...(c.lineIndices || [])];
        p.promptZh += `；同一镜继续：${c.promptZh}`;
        shots.splice(i, 1);
        merged = true;
        break;
      }
    }
    if (!merged) {
      const i = shots.findIndex((s) => s.kind === "establish");
      if (i >= 0 && shots.length > 1) {
        shots[i + 1 < shots.length ? i + 1 : i - 1]!.startSec = Math.min(shots[i]!.startSec, shots[i + 1 < shots.length ? i + 1 : i - 1]!.startSec);
        shots.splice(i, 1);
        merged = true;
      }
    }
    if (!merged) {
      // 仍超上限：把最短的一对相邻台词镜并成一镜（机位留在前一人脸上，后一句在同一镜里说完），关键句特写与反应镜不动
      let bestI = -1;
      let bestLen = Infinity;
      for (let i = 1; i < shots.length; i += 1) {
        const p = shots[i - 1]!;
        const c = shots[i]!;
        const lineShot = (x: ManhuaScheduledShot) => (x.kind === "ots" || x.kind === "single") && x !== keySingleShot;
        if (!lineShot(p) || !lineShot(c)) continue;
        const len = c.endSec - p.startSec;
        if (len < bestLen) {
          bestLen = len;
          bestI = i;
        }
      }
      if (bestI < 0) break;
      const p = shots[bestI - 1]!;
      const c = shots[bestI]!;
      p.endSec = c.endSec;
      p.noteZh = `${p.noteZh}（含下一句，机位不切）`;
      p.lineIndices = [...(p.lineIndices || []), ...(c.lineIndices || [])];
      p.promptZh = `${p.promptZh}；${c.faceZh || "对方"}接着说「${(c.lineIndices || []).map((i) => rawLines[i]!.textZh).join("／")}」，机位不切`;
      shots.splice(bestI, 1);
    }
  }
  shots.forEach((s, i) => (s.index = i + 1));
  if (input.hasContact) notesZh.push("混合段：最后一句台词后直接切起手过肩，不回建立镜");
  return { shots, layoutZh, speakersZh, keyLineIndex, notesZh };
}

/** 镜表 → 一段中文调度说明（给导演版分镜提示与创作顾问） */
export function formatManhuaShotScheduleZh(schedule: ManhuaShotSchedule): string {
  if (!schedule.shots.length) return "";
  return [`【运镜调度】${schedule.layoutZh}`, ...schedule.shots.map((s) => `${s.index}. ${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)}s ${s.promptZh}`), ...schedule.notesZh].join("\n");
}

/* ───────────── 白模相机：镜表 → previs cameras（舞台坐标） ───────────── */

type Vec2 = [number, number];
const clampStage = (v: number) => Math.max(-30, Math.min(30, Math.round(v * 100) / 100));
const clampZ = (v: number) => Math.max(0.2, Math.min(15, Math.round(v * 100) / 100));
const pt = (x: number, y: number, z: number): [number, number, number] => [clampStage(x), clampStage(y), clampZ(z)];
const LENS: Record<ManhuaScheduledScale, number> = { ws: 28, ms: 40, mcu: 50, cu: 58 };

export type ManhuaScheduledCamera = { startSec: number; endSec: number; position: [number, number, number]; target: [number, number, number]; lens: number; noteZh: string; kind: ManhuaScheduledShotKind };

/**
 * 需要每个人名对应的舞台站位（previs actor.start）；缺站位或交锋轴退化时不生成假坐标，由调用方保留原机位。
 * 过肩：机位在「过谁肩」那人的身后偏侧 0.9/0.45，高 1.55，看对方脸 1.4；单人/反应：正前方 1.6 处。
 */
export function scheduledShotsToPrevisCameras(
  shots: readonly ManhuaScheduledShot[],
  positionsByName: Record<string, Vec2>,
  opts?: { nonHumanNames?: string[] },
): ManhuaScheduledCamera[] {
  const names = Object.keys(positionsByName);
  const center: Vec2 = names.length ? [names.reduce((a, n) => a + positionsByName[n]![0], 0) / names.length, names.reduce((a, n) => a + positionsByName[n]![1], 0) / names.length] : [0, 0];
  const nonHuman = new Set(opts?.nonHumanNames || []);
  const posOf = (name: string): Vec2 => positionsByName[name] ?? center;
  const dirTo = (from: Vec2, to: Vec2): Vec2 => {
    const d: Vec2 = [to[0] - from[0], to[1] - from[1]];
    const l = Math.hypot(d[0], d[1]);
    return l < 1e-6 ? [0, 1] : [d[0] / l, d[1] / l];
  };
  const requiredNames = Array.from(new Set(shots.flatMap((s) => [s.faceZh, s.overZh || ""]).filter(Boolean)));
  if (requiredNames.some((name) => !positionsByName[name] || positionsByName[name]!.some((n) => !Number.isFinite(n)))) return [];
  // 整组正反打共享轴侧；沿同一法向量偏移，不能随主客互换翻转。
  const pair = shots.find((s) => s.kind === "ots" && s.overZh);
  let normal: Vec2 = [0, -1];
  if (pair?.overZh) {
    const a = posOf(pair.overZh), b = posOf(pair.faceZh);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) return [];
    const axis = dirTo(a, b);
    normal = [-axis[1], axis[0]];
    if (normal[1] > 0 || (Math.abs(normal[1]) < 1e-6 && normal[0] < 0)) normal = [-normal[0], -normal[1]];
  }
  return shots.map((s) => {
    if (s.kind === "establish" || !s.faceZh) {
      return { startSec: s.startSec, endSec: s.endSec, position: pt(center[0] + normal[0] * 7, center[1] + normal[1] * 7, 2.6), target: pt(center[0], center[1], 1), lens: LENS.ws, noteZh: s.noteZh, kind: s.kind };
    }
    const face = posOf(s.faceZh);
    const headZ = nonHuman.has(s.faceZh) ? 1.2 : 1.45;
    if (s.kind === "ots" && s.overZh) {
      const over = posOf(s.overZh);
      const dir = dirTo(over, face);
      const side = normal;
      return { startSec: s.startSec, endSec: s.endSec, position: pt(over[0] - dir[0] * 0.9 + side[0] * 0.45, over[1] - dir[1] * 0.9 + side[1] * 0.45, 1.55), target: pt(face[0], face[1], headZ), lens: Math.min(65, LENS[s.scale] + (nonHuman.has(s.faceZh) ? 5 : 0)), noteZh: s.noteZh, kind: s.kind };
    }
    // 单人/反应：从对手方向正面看脸（没有对手就从舞台中心方向）
    const other = names.find((n) => n !== s.faceZh);
    const from = other ? posOf(other) : center;
    const dir = dirTo(face, from);
    return { startSec: s.startSec, endSec: s.endSec, position: pt(face[0] + dir[0] * 1.6 + normal[0] * 0.45, face[1] + dir[1] * 1.6 + normal[1] * 0.45, 1.5), target: pt(face[0], face[1], headZ), lens: Math.min(65, s.kind === "reaction" ? 55 : LENS[s.scale]), noteZh: s.noteZh, kind: s.kind };
  });
}
