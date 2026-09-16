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
import type { ManhuaActionEvent } from "./manhuaActionPlan";
import { MANHUA_TIMING_FPS, manhuaSnapToFrameSec } from "./manhuaActionPlanTiming";
import type { ManhuaPrevisSpec } from "./manhuaPrevis";

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
  const motion = style === "handheld" ? "手持微晃" : style === "slow_orbit" && c.kind === "establish" ? "慢环绕" : "固定机位";
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
