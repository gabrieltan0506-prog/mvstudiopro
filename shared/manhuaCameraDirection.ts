/** 运镜、动作轨迹与白模相机的唯一实现文件。旧模块仅保留兼容导出。 */
import type { ManhuaActionEvent } from "./manhuaActionPlan";
import { MANHUA_TIMING_FPS, manhuaSnapToFrameSec } from "./manhuaActionPlanTiming";
import type { ManhuaPrevisSpec } from "./manhuaPrevis";
import { extractManhuaDialogueSpeakerName, extractManhuaSegmentDialogueQuotes } from "./manhuaEpisodeSegmentPlan.js";

// ===== manhuaCameraGrammar.ts =====
/**
 * 激烈动作运镜文法 → 白模相机编排（0915 拉片提炼，见知识库《0915-武打运镜文法》）。
 * 适用：武打、斗法（法术/远程）、追逐、爆破、出水登船——同一条因果链 准备→发力→接触→反应→恢复，
 * 差别只在「接触点」：近身=兵器/身体相接；斗法=法术命中受方；出水=破水面。
 *
 * 规则（硬桥硬马档）：
 *   建立 1.5–2s → 起手侧中景（轻推）→ 接触仰角固定机位 0.5–1s（切在接触前 5 帧）
 *   → 卸力拉远 / 反应特写 1–2s；出水低机位仰拍 → 落点俯拍；绝不连续两镜同景别同机位。
 *
 * 只产生相机，不改动作与时间映射；时间用**源秒**并吸附 24 帧；输出满足 manhuaPrevisSpec.cameras：
 *   连续覆盖 [0, durationSec]、≤8 镜、position/target 在舞台范围内、lens 18–65 整数。
 */

export type ManhuaCameraStyle = "hard" | "slow_orbit" | "handheld";

export type ManhuaCameraShotKind = "establish" | "windup" | "over_shoulder" | "contact" | "recover" | "reaction" | "emerge_low" | "land_high";

export type ManhuaChoreographedCamera = ManhuaPrevisSpec["cameras"][number] & {
  kind: ManhuaCameraShotKind;
  /** 这镜服务的事件（建立镜无） */
  eventId?: string;
  noteZh: string;
};

export type ManhuaCameraChoreographyInput = {
  durationSec: number;
  events: ManhuaActionEvent[];
  /** 事件相对本可执行镜头源起点的接触点（来自 manhuaPrevisTiming） */
  cues: Array<{ eventId: string; contactSec: number; windupStartSec: number; recoverEndSec: number }>;
  /** 舞台平面站位（previs actor.start） */
  actorPositions: Record<string, [number, number]>;
  style?: ManhuaCameraStyle;
  /** 单段最多镜数（previs 合同 8） */
  maxCuts?: number;
  /** 每个事件的交手方式：melee 近身（默认）/ ranged 斗法·远程（施法起手手部特写、命中在受方侧） */
  eventManner?: Record<string, "melee" | "ranged">;
  /** 节奏策略（PR-6，见 manhuaCameraTempo）：切镜上限、最短镜长、反应镜停留、风格档；显式 style/maxCuts 优先 */
  tempo?: ManhuaCameraTempoParams;
  /** 非人角色（马/兽等）：导演卡「非人角色先成为人物」时反应镜给它 */
  nonHumanActorIds?: string[];
};

export type ManhuaCameraTempoParams = {
  maxCuts?: number;
  minShotSec?: number;
  reactionHoldSec?: number;
  style?: ManhuaCameraStyle;
  /** 先立戏核：慢环绕建立镜优先（没有建立镜也补一镜，但不推迟接触镜） */
  establishFirst?: boolean;
  reactionToNonHuman?: boolean;
  reactionLens?: number;
};

/** 反应特写默认停留（拉片：受方反应 1–2s） */
const DEFAULT_REACTION_HOLD_SEC = 1.25;

export const MANHUA_CAMERA_MAX_CUTS = 8;
const FRAME = 1 / MANHUA_TIMING_FPS;
/** 切在接触前 5 帧（拉片：示范片接触镜起点均在火花前约 0.2s） */
export const CONTACT_LEAD_FRAMES = 5;
const MIN_CUT_SEC = 12 * FRAME; // 半秒：短于此的镜并入邻镜

type Vec2 = [number, number];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: Vec2) => Math.hypot(a[0], a[1]) || 1;
const norm = (a: Vec2): Vec2 => [a[0] / len(a), a[1] / len(a)];
const perp = (a: Vec2): Vec2 => [-a[1], a[0]];
const clampStage = (v: number) => Math.max(-30, Math.min(30, Math.round(v * 100) / 100));
const clampZ = (v: number) => Math.max(0.2, Math.min(15, Math.round(v * 100) / 100));
const pt = (x: number, y: number, z: number): [number, number, number] => [clampStage(x), clampStage(y), clampZ(z)];
const fr = (s: number) => manhuaSnapToFrameSec(s);

function stageCenter(positions: Record<string, Vec2>): Vec2 {
  const all = Object.values(positions);
  if (!all.length) return [0, 0];
  return [all.reduce((a, p) => a + p[0], 0) / all.length, all.reduce((a, p) => a + p[1], 0) / all.length];
}

function counterpartOf(e: ManhuaActionEvent): string | undefined {
  if (e.kind === "attack") return e.targetActorId;
  if (e.kind === "evade") return e.threatActorId;
  return undefined;
}

type Draft = { kind: ManhuaCameraShotKind; startSec: number; endSec: number; position: [number, number, number]; target: [number, number, number]; lens: number; eventId?: string; noteZh: string; priority: number };

export function choreographManhuaCameras(input: ManhuaCameraChoreographyInput): { cameras: ManhuaChoreographedCamera[]; notesZh: string[] } {
  const D = input.durationSec;
  const tempo = input.tempo ?? {};
  const maxCuts = Math.min(MANHUA_CAMERA_MAX_CUTS, Math.max(1, input.maxCuts ?? tempo.maxCuts ?? MANHUA_CAMERA_MAX_CUTS));
  const style = input.style ?? tempo.style ?? "hard";
  const minShotSec = Math.max(MIN_CUT_SEC, Number.isFinite(tempo.minShotSec) ? (tempo.minShotSec as number) : MIN_CUT_SEC);
  const reactionHold = Math.max(FRAME, Number.isFinite(tempo.reactionHoldSec) ? (tempo.reactionHoldSec as number) : DEFAULT_REACTION_HOLD_SEC);
  const reactionLens = Math.round(Math.max(18, Math.min(65, tempo.reactionLens ?? 55)));
  const nonHuman = new Set(input.nonHumanActorIds ?? []);
  const center = stageCenter(input.actorPositions);
  const notesZh: string[] = [];
  const wide = (): Pick<Draft, "position" | "target" | "lens"> => ({ position: pt(center[0], center[1] - 7, 2.6), target: pt(center[0], center[1], 1), lens: 28 });
  const drafts: Draft[] = [];
  const cueById = new Map(input.cues.map((c) => [c.eventId, c] as const));

  for (const e of input.events) {
    const cue = cueById.get(e.eventId);
    if (!cue) continue;
    const a: Vec2 = input.actorPositions[e.actorId] ?? center;
    const other = counterpartOf(e);
    const b: Vec2 = other ? (input.actorPositions[other] ?? center) : center;
    // 攻方 → 受方；攻受同点（距离 0）时 norm 会得到零向量，机位/目标全部塌到同一点 → 用舞台朝向 +Y 兜底（1470 R1）
    const delta = sub(b, a);
    const dir: Vec2 = Math.hypot(delta[0], delta[1]) < 1e-6 ? [0, 1] : norm(delta);
    const side = perp(dir);
    const contactStart = fr(Math.max(0, cue.contactSec - CONTACT_LEAD_FRAMES * FRAME));
    const contactEnd = fr(Math.min(D, Math.max(contactStart + MIN_CUT_SEC, Math.min(cue.contactSec + 1.0, cue.recoverEndSec))));

    if (e.kind === "emerge") {
      // 出水：低机位仰拍浪花 → 落点俯拍
      drafts.push({ kind: "emerge_low", eventId: e.eventId, startSec: fr(Math.max(0, cue.windupStartSec)), endSec: contactEnd, position: pt(a[0] + side[0] * 2.5, a[1] + side[1] * 2.5, 0.4), target: pt(a[0], a[1], 1.2), lens: 32, noteZh: `${e.actorId} 出水：低机位仰拍`, priority: 3 });
      drafts.push({ kind: "land_high", eventId: e.eventId, startSec: contactEnd, endSec: fr(Math.min(D, cue.recoverEndSec + 0.75)), position: pt(a[0] - dir[0] * 3, a[1] - dir[1] * 3, 4.2), target: pt(a[0], a[1], 0.6), lens: 30, noteZh: "落点俯拍", priority: 2 });
      continue;
    }
    if (e.kind === "attack" || e.kind === "land") {
      const windupStart = fr(Math.max(0, cue.windupStartSec));
      const ranged = input.eventManner?.[e.eventId] === "ranged";
      if (contactStart - windupStart >= MIN_CUT_SEC) {
        drafts.push(
          ranged
            ? { kind: "windup", eventId: e.eventId, startSec: windupStart, endSec: contactStart, position: pt(a[0] + dir[0] * 1.2 + side[0] * 0.8, a[1] + dir[1] * 1.2 + side[1] * 0.8, 1.3), target: pt(a[0] + dir[0] * 0.5, a[1] + dir[1] * 0.5, 1.2), lens: 55, noteZh: `${e.actorId} 施法起手：手部/法印特写`, priority: 2 }
            : other
              // 近身起手：过肩镜——机位贴在攻方肩后，看受方的脸（审片：全平视侧面中景是「摆姿势不打架」的主因）
              ? { kind: "over_shoulder", eventId: e.eventId, startSec: windupStart, endSec: contactStart, position: pt(a[0] - dir[0] * 0.9 + side[0] * 0.45, a[1] - dir[1] * 0.9 + side[1] * 0.45, 1.55), target: pt(b[0], b[1], 1.4), lens: 45, noteZh: `${e.actorId} 起手：从其肩后过肩看 ${other}`, priority: 2 }
              : { kind: "windup", eventId: e.eventId, startSec: windupStart, endSec: contactStart, position: pt(a[0] + side[0] * 3, a[1] + side[1] * 3, 1.4), target: pt(a[0], a[1], 1.2), lens: 40, noteZh: `${e.actorId} 起手：侧面中景`, priority: 2 },
        );
      }
      // 接触：近身=攻方侧低机位仰角；斗法=受方侧低机位全景看命中与余波；都是固定机位，切在接触前 5 帧
      drafts.push(
        ranged
          ? { kind: "contact", eventId: e.eventId, startSec: contactStart, endSec: contactEnd, position: pt(b[0] + dir[0] * 2.5 + side[0] * 2.2, b[1] + dir[1] * 2.5 + side[1] * 2.2, 0.7), target: pt(b[0], b[1], 1.2), lens: 32, noteZh: `法术命中 ${other ?? ""}：受方侧低机位全景（切在接触前 ${CONTACT_LEAD_FRAMES} 帧）`, priority: 4 }
          : { kind: "contact", eventId: e.eventId, startSec: contactStart, endSec: contactEnd, position: pt(a[0] - dir[0] * 1.2 + side[0] * 1.6, a[1] - dir[1] * 1.2 + side[1] * 1.6, 0.6), target: pt(b[0], b[1], 1.3), lens: e.kind === "land" ? 35 : 45, noteZh: e.kind === "land" ? "登船落地：仰角" : `接触：仰角固定机位（切在接触前 ${CONTACT_LEAD_FRAMES} 帧）`, priority: 4 },
      );
      const recoverEnd = fr(Math.min(D, Math.max(contactEnd + MIN_CUT_SEC, cue.recoverEndSec)));
      if (other && e.kind === "attack") {
        // 反应特写：受方先；导演卡「非人角色先成为人物」且攻方是非人、受方不是 → 反应给非人攻方
        const toAttacker = Boolean(tempo.reactionToNonHuman) && nonHuman.has(e.actorId) && !nonHuman.has(other);
        const who = toAttacker ? e.actorId : other;
        const p: Vec2 = toAttacker ? a : b;
        const face: Vec2 = toAttacker ? [-dir[0], -dir[1]] : dir;
        drafts.push({ kind: "reaction", eventId: e.eventId, startSec: contactEnd, endSec: fr(Math.min(D, contactEnd + reactionHold)), position: pt(p[0] - face[0] * 1.5, p[1] - face[1] * 1.5, 1.5), target: pt(p[0], p[1], 1.5), lens: reactionLens, noteZh: `${who} 反应特写${toAttacker ? "（非人角色先成人物）" : ""}`, priority: 3 });
      } else if (recoverEnd - contactEnd >= MIN_CUT_SEC) {
        drafts.push({ kind: "recover", eventId: e.eventId, startSec: contactEnd, endSec: recoverEnd, ...wide(), lens: 30, noteZh: "卸力：拉远", priority: 1 });
      }
    }
  }

  if (!drafts.length) {
    return { cameras: [{ ...wide(), startSec: 0, endSec: D, kind: "establish", noteZh: "无事件：默认全景机位" }], notesZh: ["本镜没有动作事件，用默认全景"] };
  }

  // 按起点排序；重叠时高优先级赢，低优先级被裁短或丢弃
  drafts.sort((x, y) => x.startSec - y.startSec || y.priority - x.priority);
  const laid: Draft[] = [];
  let cursor = 0;
  for (const d of drafts) {
    const prev = laid[laid.length - 1];
    // 高优先级（接触）先把前一低优先级镜裁短，再判断自己还剩多少：否则反应镜停留一长，后面的接触镜会被整镜丢掉（PR-6 修）
    if (prev && prev.priority < d.priority && prev.endSec > d.startSec) {
      prev.endSec = Math.max(prev.startSec + FRAME, d.startSec);
      cursor = prev.endSec;
    }
    const start = Math.max(d.startSec, cursor);
    if (d.endSec - start < FRAME) continue;
    laid.push({ ...d, startSec: start });
    cursor = laid[laid.length - 1]!.endSec;
  }
  // 建立镜：首镜前若有 ≥ 半秒空档；更短的空档并入首镜（必须从 0 覆盖）
  const cams: Draft[] = [];
  if (laid[0]!.startSec >= MIN_CUT_SEC) cams.push({ kind: "establish", startSec: 0, endSec: laid[0]!.startSec, ...wide(), noteZh: "建立：高位全景", priority: 1 });
  else laid[0]!.startSec = 0;
  // 空档：沿用上一镜（镜头不动，让动作动）
  for (const d of laid) {
    const prev = cams[cams.length - 1];
    if (prev && d.startSec > prev.endSec) prev.endSec = d.startSec;
    cams.push(d);
  }
  cams[cams.length - 1]!.endSec = D;
  // 慢环绕 / 先立戏核：建立镜延长到 ≥ minShotSec，但不越过第一个接触/出水镜的起点（不推迟接触）
  const slowEstablish = style === "slow_orbit" || Boolean(tempo.establishFirst);
  if (slowEstablish && D > FRAME) {
    const firstHard = cams.find((c) => c.kind === "contact" || c.kind === "emerge_low");
    const limit = fr(Math.min(firstHard ? firstHard.startSec : D - FRAME, minShotSec));
    if (cams[0]!.kind !== "establish" && cams[0]!.kind !== "contact" && cams[0]!.kind !== "emerge_low" && limit >= MIN_CUT_SEC) {
      cams.unshift({ kind: "establish", startSec: 0, endSec: 0, ...wide(), noteZh: "建立：慢环绕立戏核", priority: 1 });
    }
    const est = cams[0]!;
    if (est.kind === "establish") {
      est.noteZh = "建立：慢环绕立戏核";
      const target = Math.max(est.endSec, limit);
      est.endSec = target;
      for (let i = 1; i < cams.length; ) {
        const c = cams[i]!;
        if (c.endSec - target < FRAME) { cams.splice(i, 1); continue; }
        if (c.startSec < target) c.startSec = target;
        i += 1;
      }
    }
    cams[cams.length - 1]!.endSec = D;
  }
  // 太短的镜并入邻镜（节奏档给的最短镜长优先，接触镜例外：接触本来就短）；超过上限先丢最低优先级
  const merge = () => {
    for (let i = 0; i < cams.length; i += 1) {
      const c = cams[i]!;
      const floor = c.kind === "contact" || c.kind === "emerge_low" ? MIN_CUT_SEC : minShotSec;
      if (c.endSec - c.startSec < floor && cams.length > 1) {
        const into = i > 0 ? cams[i - 1]! : cams[1]!;
        if (i > 0) into.endSec = c.endSec; else into.startSec = c.startSec;
        cams.splice(i, 1);
        return true;
      }
    }
    return false;
  };
  while (merge()) { /* 直到没有短镜 */ }
  while (cams.length > maxCuts) {
    let idx = 0;
    for (let i = 1; i < cams.length; i += 1) if (cams[i]!.priority < cams[idx]!.priority) idx = i;
    const c = cams[idx]!;
    if (idx > 0) cams[idx - 1]!.endSec = c.endSec; else cams[1]!.startSec = c.startSec;
    cams.splice(idx, 1);
    notesZh.push(`镜数超过 ${maxCuts}，并掉「${c.noteZh}」`);
  }
  // 风格档：慢环绕真改切点（建立镜延长、并到 ≤ maxCuts）；手持只标注，白模合同没有运动字段
  if (style === "slow_orbit") notesZh.push(`风格「慢环绕」：建立镜 ≥ ${minShotSec.toFixed(1)}s、最多 ${maxCuts} 镜`);
  if (style === "handheld") notesZh.push("风格「手持」只进提示词，白模相机切点与硬切档相同");

  const cameras: ManhuaChoreographedCamera[] = cams.map((c) => ({
    startSec: fr(c.startSec), endSec: fr(c.endSec), position: c.position, target: c.target, lens: Math.round(Math.max(18, Math.min(65, c.lens))),
    // 既有卸力拉远从文字落到白模坐标，不改接触点或人物动作时间。
    ...(c.kind === "recover" ? { endPosition: pt(...c.position.map((n, i) => c.target[i] + (n - c.target[i]) * 1.15) as [number, number, number]) } : {}),
    ...(style === "slow_orbit" && c.kind === "establish" ? { orbitDeg: 30 } : {}),
    kind: c.kind, ...(c.eventId ? { eventId: c.eventId } : {}), noteZh: c.noteZh,
  }));
  cameras[0]!.startSec = 0;
  for (let i = 1; i < cameras.length; i += 1) cameras[i]!.startSec = cameras[i - 1]!.endSec;
  cameras[cameras.length - 1]!.endSec = D;
  return { cameras, notesZh };
}

/** 给视频模型的运镜提示词（每镜一句），与白模相机同源 */
export function manhuaCameraPromptZh(c: ManhuaChoreographedCamera, style: ManhuaCameraStyle = "hard"): string {
  const scale = c.kind === "over_shoulder" ? "过肩中近景" : c.lens >= 50 ? "特写" : c.lens >= 38 ? "中景" : "全景";
  const angle = c.position[2] < 0.9 ? "仰角" : c.position[2] > 3 ? "俯角" : "平视";
  const motion = c.endPosition ? "拉远" : style === "handheld" ? "手持微晃" : style === "slow_orbit" && c.kind === "establish" ? "慢环绕" : "固定机位";
  return `${c.startSec.toFixed(2)}–${c.endSec.toFixed(2)}s ${scale}·${angle}·${motion}：${c.noteZh}`;
}

export type ManhuaCameraVarietyIssue = { code: "same_setup_too_long" | "flat_only" | "no_over_shoulder" | "no_reaction"; messageZh: string };

function heightClass(c: Pick<ManhuaChoreographedCamera, "position">): "low" | "eye" | "high" {
  return c.position[2] < 0.9 ? "low" : c.position[2] > 3 ? "high" : "eye";
}
function scaleClass(c: Pick<ManhuaChoreographedCamera, "lens" | "kind">): string {
  return c.kind === "over_shoulder" ? "ots" : c.lens >= 50 ? "cu" : c.lens >= 38 ? "ms" : "ws";
}

/**
 * 景别/机位多样性门禁（0916 审片规则）：
 *   - 同机位高度 + 同景别连续 > maxSameSetupSec（默认 3s）→ 原地拉扯
 *   - 段长 > 6s 且从头到尾只有一种机位高度（全平视）→ 没有仰俯
 *   - 有近身交手却没有过肩镜 / 没有反应镜
 * 只报不改：编排器已按文法出镜，这里是给人看的告警与给顾问的信号。
 */
export function assessManhuaCameraVariety(
  cameras: readonly ManhuaChoreographedCamera[],
  opts?: { maxSameSetupSec?: number; hasMelee?: boolean },
): ManhuaCameraVarietyIssue[] {
  const issues: ManhuaCameraVarietyIssue[] = [];
  const maxSame = opts?.maxSameSetupSec ?? 3;
  if (!cameras.length) return issues;
  let runStart = cameras[0]!.startSec;
  let runKey = `${heightClass(cameras[0]!)}:${scaleClass(cameras[0]!)}`;
  const flag = (end: number) => {
    const len = end - runStart;
    if (len > maxSame + 1e-6) issues.push({ code: "same_setup_too_long", messageZh: `同机位同景别连续 ${len.toFixed(1)} 秒（${runStart.toFixed(1)}–${end.toFixed(1)}s），超过 ${maxSame} 秒会变成原地拉扯` });
  };
  for (let i = 1; i < cameras.length; i += 1) {
    const key = `${heightClass(cameras[i]!)}:${scaleClass(cameras[i]!)}`;
    if (key !== runKey) {
      flag(cameras[i]!.startSec);
      runStart = cameras[i]!.startSec;
      runKey = key;
    }
  }
  flag(cameras[cameras.length - 1]!.endSec);
  const total = cameras[cameras.length - 1]!.endSec - cameras[0]!.startSec;
  const heights = new Set(cameras.map(heightClass));
  if (total > 6 && heights.size === 1) issues.push({ code: "flat_only", messageZh: "整段只有一种机位高度（全平视/全仰/全俯），接触点没有仰角、落点没有俯拍" });
  const melee = opts?.hasMelee ?? cameras.some((c) => c.kind === "contact");
  if (melee && !cameras.some((c) => c.kind === "over_shoulder")) issues.push({ code: "no_over_shoulder", messageZh: "有近身交手但没有过肩镜：起手段应从攻方肩后看受方" });
  if (melee && !cameras.some((c) => c.kind === "reaction")) issues.push({ code: "no_reaction", messageZh: "有交手但没有反应特写：接触后要看受方的脸" });
  return issues;
}

// ===== manhuaShotScheduler.ts =====
/**
 * 运镜调度生成器（0916）：把一段可拍表（对白 + 出场人物 + 节奏档）变成镜表——
 * 对白戏按「过肩公式」出镜（谁在前景/过谁肩/拍谁脸 → 景别推情绪 → 关键句反应镜），
 * 动作戏交给 manhuaCameraGrammar（接触点切镜），混合段最后一句台词直接切起手。
 *
 * 规则真源：知识库《漫剧工厂/0916-过肩镜头与对话运镜调度》+ 技能 fight-camera-grammar 第七节。
 * 纯函数、不碰网络；导演版分镜（manhuaStoryDistill）与白模相机（manhuaPrevisFromActionPlan）共用。
 */

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

const SCHEDULE_FPS = 24;
const scheduleFrame = (s: number) => Math.round(s * SCHEDULE_FPS) / SCHEDULE_FPS;

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
        : [{ index: 1, kind: "establish", startSec: 0, endSec: scheduleFrame(fullD), faceZh: "", scale: "ws", height: "eye", noteZh: "无对白无接触：建立全景", promptZh: "全景建立空间纵深与人物站位" }],
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
    const start = scheduleFrame(t);
    const end = scheduleFrame(Math.min(D, t + sec));
    if (end - start < 1 / SCHEDULE_FPS) return;
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
      shot.startSec = scheduleFrame(cursor);
      shot.endSec = scheduleFrame(cursor + duration);
      cursor = shot.endSec;
    }
  }
  // 末镜补到段尾（混合段：段尾交给动作文法，不补）
  if (shots.length && !input.hasContact && shots[shots.length - 1]!.endSec < D) shots[shots.length - 1]!.endSec = scheduleFrame(D);

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

type ScheduledVec2 = [number, number];
const clampScheduledStage = (v: number) => Math.max(-30, Math.min(30, Math.round(v * 100) / 100));
const clampScheduledZ = (v: number) => Math.max(0.2, Math.min(15, Math.round(v * 100) / 100));
const scheduledPoint = (x: number, y: number, z: number): [number, number, number] => [clampScheduledStage(x), clampScheduledStage(y), clampScheduledZ(z)];
const LENS: Record<ManhuaScheduledScale, number> = { ws: 28, ms: 40, mcu: 50, cu: 58 };

export type ManhuaScheduledCamera = { startSec: number; endSec: number; position: [number, number, number]; target: [number, number, number]; lens: number; noteZh: string; kind: ManhuaScheduledShotKind };

/**
 * 需要每个人名对应的舞台站位（previs actor.start）；缺站位或交锋轴退化时不生成假坐标，由调用方保留原机位。
 * 过肩：机位在「过谁肩」那人的身后偏侧 0.9/0.45，高 1.55，看对方脸 1.4；单人/反应：正前方 1.6 处。
 */
export function scheduledShotsToPrevisCameras(
  shots: readonly ManhuaScheduledShot[],
  positionsByName: Record<string, ScheduledVec2>,
  opts?: { nonHumanNames?: string[] },
): ManhuaScheduledCamera[] {
  const names = Object.keys(positionsByName);
  const center: ScheduledVec2 = names.length ? [names.reduce((a, n) => a + positionsByName[n]![0], 0) / names.length, names.reduce((a, n) => a + positionsByName[n]![1], 0) / names.length] : [0, 0];
  const nonHuman = new Set(opts?.nonHumanNames || []);
  const posOf = (name: string): ScheduledVec2 => positionsByName[name] ?? center;
  const dirTo = (from: ScheduledVec2, to: ScheduledVec2): ScheduledVec2 => {
    const d: ScheduledVec2 = [to[0] - from[0], to[1] - from[1]];
    const l = Math.hypot(d[0], d[1]);
    return l < 1e-6 ? [0, 1] : [d[0] / l, d[1] / l];
  };
  const requiredNames = Array.from(new Set(shots.flatMap((s) => [s.faceZh, s.overZh || ""]).filter(Boolean)));
  if (requiredNames.some((name) => !positionsByName[name] || positionsByName[name]!.some((n) => !Number.isFinite(n)))) return [];
  // 整组正反打共享轴侧；沿同一法向量偏移，不能随主客互换翻转。
  const pair = shots.find((s) => s.kind === "ots" && s.overZh);
  let normal: ScheduledVec2 = [0, -1];
  if (pair?.overZh) {
    const a = posOf(pair.overZh), b = posOf(pair.faceZh);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) return [];
    const axis = dirTo(a, b);
    normal = [-axis[1], axis[0]];
    if (normal[1] > 0 || (Math.abs(normal[1]) < 1e-6 && normal[0] < 0)) normal = [-normal[0], -normal[1]];
  }
  return shots.map((s) => {
    if (s.kind === "establish" || !s.faceZh) {
      return { startSec: s.startSec, endSec: s.endSec, position: scheduledPoint(center[0] + normal[0] * 7, center[1] + normal[1] * 7, 2.6), target: scheduledPoint(center[0], center[1], 1), lens: LENS.ws, noteZh: s.noteZh, kind: s.kind };
    }
    const face = posOf(s.faceZh);
    const headZ = nonHuman.has(s.faceZh) ? 1.2 : 1.45;
    if (s.kind === "ots" && s.overZh) {
      const over = posOf(s.overZh);
      const dir = dirTo(over, face);
      const side = normal;
      return { startSec: s.startSec, endSec: s.endSec, position: scheduledPoint(over[0] - dir[0] * 0.9 + side[0] * 0.45, over[1] - dir[1] * 0.9 + side[1] * 0.45, 1.55), target: scheduledPoint(face[0], face[1], headZ), lens: Math.min(65, LENS[s.scale] + (nonHuman.has(s.faceZh) ? 5 : 0)), noteZh: s.noteZh, kind: s.kind };
    }
    // 单人/反应：从对手方向正面看脸（没有对手就从舞台中心方向）
    const other = names.find((n) => n !== s.faceZh);
    const from = other ? posOf(other) : center;
    const dir = dirTo(face, from);
    return { startSec: s.startSec, endSec: s.endSec, position: scheduledPoint(face[0] + dir[0] * 1.6 + normal[0] * 0.45, face[1] + dir[1] * 1.6 + normal[1] * 0.45, 1.5), target: scheduledPoint(face[0], face[1], headZ), lens: Math.min(65, s.kind === "reaction" ? 55 : LENS[s.scale]), noteZh: s.noteZh, kind: s.kind };
  });
}

// ===== manhuaActionCameraRecipeBank.ts =====
/**
 * 动作运镜配方：FPV / 动作全景轨迹 / 红蓝双轨迹一镜到底。
 * 语义来自公开 I2V 轨迹教程（自研条目，不抄原片）。
 */

export type ManhuaActionTrackMode = "fpv" | "single_action" | "dual";

export type ManhuaActionCameraRecipe = {
  id: string;
  no: number;
  nameZh: string;
  trackMode: ManhuaActionTrackMode;
  effectZh: string;
  whenToUseZh: string;
  craftSummaryZh: string;
  craftLockEn: string;
  seedancePromptZh: string;
};

export const MANHUA_ACTION_CAMERA_RECIPE_BANK: readonly ManhuaActionCameraRecipe[] = [
  {
    id: "action_fpv_stadium",
    no: 1,
    nameZh: "穿越机掠群",
    trackMode: "fpv",
    effectZh: "鱼眼畸变+径向运动模糊，高速俯冲掠过人群/球场。",
    whenToUseZh: "球赛、战争群像、大场面开场、多人群演。",
    craftSummaryZh: "单主运镜=FPV 冲刺；禁叠第二种大运镜；人群地理可读。",
    craftLockEn: "FPV fisheye dive, radial motion blur, readable crowd geography, one primary move",
    seedancePromptZh:
      "第一人称穿越机视角高速掠过人群与场地，鱼眼畸变，径向运动模糊，方向清晰，主体位置稳定，禁止轨迹线出现在成片。",
  },
  {
    id: "action_fight_panorama_track",
    no: 2,
    nameZh: "动作全景轨迹",
    trackMode: "single_action",
    effectZh: "先全景静帧，再沿动作轨迹完成移动/闪避/攻防或肢体移位。",
    whenToUseZh: "打斗、追逐、比武、比赛冲刺，以及任何明显肢体动作与身体移位。",
    craftSummaryZh: "人物沿红色动作轨；镜头相对稳或轻跟；2–3 秒一段动作反馈。",
    craftLockEn:
      "body motion along action track: move dodge interact, smooth, stable positions, hide guides",
    seedancePromptZh:
      "一人或多人沿着画面中的运动轨迹完成肢体动作与身体移位（移动、闪避、攻防或互动）。动作流畅，方向明确，人物位置稳定。轨迹线仅作参考，最终画面不显示。",
  },
  {
    id: "action_dual_track_oner",
    no: 3,
    nameZh: "红蓝双轨一镜",
    trackMode: "dual",
    effectZh: "红轨=人物动作，蓝轨=镜头路径；可绕过主体的一镜调度。",
    whenToUseZh: "一镜到底、多人同框、群演调度、复杂空间穿插。",
    craftSummaryZh: "人物严格沿红轨；镜头严格沿蓝轨；人/景/空间关系稳定；可绕过主体。",
    craftLockEn:
      "dual tracks: subject on red path, camera on blue path, may bypass subject, hide guide lines",
    seedancePromptZh:
      "参考轨迹图、人物参考与场景图生成视频。人物严格沿红色轨迹移动与动作；镜头严格沿蓝色轨迹运动。保持人物一致、场景一致、空间关系稳定；动作流畅、方向明确。轨迹线仅作参考，最终画面不显示。",
  },
];

export function getActionCameraRecipeById(id?: string | null): ManhuaActionCameraRecipe | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return MANHUA_ACTION_CAMERA_RECIPE_BANK.find((e) => e.id === key) || null;
}

export function listActionCameraRecipes(): readonly ManhuaActionCameraRecipe[] {
  return MANHUA_ACTION_CAMERA_RECIPE_BANK;
}

export function buildActionCameraInjectBlock(ids: string[]): string {
  const picked = ids.map(getActionCameraRecipeById).filter(Boolean) as ManhuaActionCameraRecipe[];
  if (!picked.length) return "";
  const lines = picked.map(
    (e, i) =>
      `${i + 1}. 【动作运镜·${e.trackMode}】${e.nameZh}：${e.craftSummaryZh}\n   Seedance：${e.seedancePromptZh}`,
  );
  return [
    "【动作运镜配方】",
    "硬规则：红轨人物 / 蓝轨镜头（双轨时）；轨迹线最终不显示；禁止导演名与外仓品牌。",
    ...lines,
  ].join("\n");
}

export function recommendActionCameraFromTopic(topic?: string): {
  recipeId: string | null;
  entry: ManhuaActionCameraRecipe | null;
  reasonZh: string;
} {
  const t = String(topic || "").trim();
  const hints: Array<{ keys: string[]; id: string }> = [
    // 赛场 / 人群穿越感
    {
      keys: ["穿越", "FPV", "球场", "球赛", "赛场", "比赛", "竞技", "运动会", "观众", "人群", "战争群"],
      id: "action_fpv_stadium",
    },
    // 肢体动作 / 身体移位 / 打斗（单红轨动作）
    {
      keys: [
        "打斗",
        "对打",
        "比武",
        "交锋",
        "武打",
        "搏斗",
        "格斗",
        "追逐",
        "奔跑",
        "冲刺",
        "跳跃",
        "翻滚",
        "闪避",
        "扑击",
        "推搡",
        "拉扯",
        "移位",
        "肢体",
        "身体",
        "对决",
      ],
      id: "action_fight_panorama_track",
    },
    // 多人同框 / 群演调度（红蓝双轨）
    {
      keys: ["一镜", "双轨", "绕过", "群演", "调度", "多人", "双人", "三人", "众人", "同框", "群戏", "围观"],
      id: "action_dual_track_oner",
    },
  ];
  for (const h of hints) {
    if (h.keys.some((k) => t.includes(k))) {
      const entry = getActionCameraRecipeById(h.id);
      return {
        recipeId: entry?.id || null,
        entry,
        reasonZh: `题材偏「${h.keys.find((k) => t.includes(k))}」→ 推荐「${entry?.nameZh}」`,
      };
    }
  }
  const fallback = getActionCameraRecipeById("action_dual_track_oner");
  return {
    recipeId: fallback?.id || null,
    entry: fallback,
    reasonZh: "未强命中，推荐红蓝双轨一镜（可更换）",
  };
}

/** 双轨中文编译（Seedance / I2V / 界面同一套） */
export function compileDualTrackMotionPrompt(opts: {
  subjectBeats: string[];
  cameraBeats: string[];
}): string {
  const subject = opts.subjectBeats.filter(Boolean);
  const camera = opts.cameraBeats.filter(Boolean);
  return [
    "红蓝双轨：人物沿红轨动作，镜头沿蓝轨调度。",
    "成片不显示轨迹参考线。",
    subject.length ? `人物节拍：${subject.join(" → ")}` : "",
    camera.length ? `镜头节拍：${camera.join(" → ")}` : "",
    "保持人物身份、场景连续与空间关系稳定，动作流畅。",
  ]
    .filter(Boolean)
    .join("\n");
}

// ===== manhuaPrevisCameraRecipe.ts =====
/** 既有穿越机配方的舞台预演；不用屏幕红蓝线推测场景深度。 */
export function previsCamerasFromActionRecipe(recipeId: string | undefined, durationSec: number, actors: ManhuaPrevisSpec["actors"]): ManhuaPrevisSpec["cameras"] | null {
  if (getActionCameraRecipeById(recipeId)?.trackMode !== "fpv" || !actors.length) return null;
  const x = actors.reduce((sum, actor) => sum + actor.start[0], 0) / actors.length;
  const y = actors.reduce((sum, actor) => sum + actor.start[1], 0) / actors.length;
  const target: [number, number, number] = [x, y, 1];
  // 高处俯冲、侧掠主体、拉升；终点与下一段起点同源。
  const points: [number, number, number][] = [[x - 5, y - 8, 8], [x - 3, y - 4, 2.5], [x + 3, y - 3, 2.5], [x + 5, y + 4, 7]];
  const times = [0, Math.round(durationSec * 24 / 3) / 24, Math.round(durationSec * 24 * 2 / 3) / 24, durationSec];
  return points.slice(0, -1).map((position, i) => ({ startSec: times[i], endSec: times[i + 1], position, endPosition: points[i + 1], target, lens: 24 }));
}
