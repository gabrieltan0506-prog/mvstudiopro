/**
 * 动作计划 → 白模规格草案（PR-4）：创作者在时间轴上排好起手/接触/卸力，
 * 这里把它翻成 ManhuaPrevisStudio 能直接套用的 spec 草案，**不再手填秒数**。
 *
 * 老实口径：
 *   - 时间全部来自 manhuaPrevisTiming（同一 timeMap，源秒），不另造。
 *   - 站位是**默认排布**（白模舞台平面），不是计划的世界坐标——屏幕点不冒充 world；
 *     摘要里明说「站位为默认排布」，创作者可在高级参数改。
 *   - 相机：计划相机没有位置信息 → 给一台默认机位覆盖整段并写明；不假称已解析。
 *   - 产出先过生产 schema：不过就把原因带回，UI 不得静默套用。
 */
import { manhuaPrevisSpecSchema, type ManhuaPrevisSpec } from "./manhuaPrevis";
import { compileManhuaShotSnapshot, type ManhuaActionPlan, type ManhuaActionEvent } from "./manhuaActionPlan";
import type { ManhuaExecutableShot } from "./manhuaActionPlanSplit";
import type { ManhuaResolvedCameraSource } from "./manhuaActionPlanBindings";
import { manhuaPrevisTimingForExecutableShot, type ManhuaPrevisTiming } from "./manhuaPrevisTiming";
import { manhuaSnapToFrameSec } from "./manhuaActionPlanTiming";
import { choreographManhuaCameras, manhuaCameraPromptZh, type ManhuaCameraStyle } from "./manhuaCameraGrammar";

export type ManhuaPrevisCharacterLink = {
  actorId: string;
  /** 资产卡 id（previs actor.assetRef） */
  assetRef?: string;
  shape?: "human" | "horse";
};

export type ManhuaPrevisDraftFromPlan = {
  executableShotId: string;
  sourceShotId: string;
  kind: ManhuaExecutableShot["kind"];
  timing: ManhuaPrevisTiming;
  /** 过了生产 schema 的规格；没过为 null，看 issuesZh */
  spec: ManhuaPrevisSpec | null;
  /** 给创作者看的白话摘要（含每镜运镜提示词，可直接喂视频模型） */
  summaryZh: string[];
  issuesZh: string[];
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r2 = (n: number) => Math.round(n * 100) / 100;
/** 白模合同要求秒位对齐 24 帧：一律吸附到帧，不用十进制四舍五入 */
const fr = (n: number) => manhuaSnapToFrameSec(n);
const QUARTER = 0.25;

/** 默认站位：按人数在舞台横向均匀排开，面朝舞台中心 */
function defaultFormation(count: number): Array<{ start: [number, number]; facingDeg: number }> {
  if (count <= 1) return [{ start: [0, 0], facingDeg: 0 }];
  const span = Math.min(8, 2.5 * (count - 1));
  return Array.from({ length: count }, (_, i) => {
    const x = r2(-span / 2 + (span * i) / (count - 1));
    return { start: [x, 0] as [number, number], facingDeg: x < 0 ? 0 : 180 };
  });
}

export function manhuaPrevisDraftFromExecutableShot(input: {
  plan: ManhuaActionPlan;
  shot: ManhuaExecutableShot;
  resolvedCamera?: ManhuaResolvedCameraSource | null;
  aspect: "16:9" | "9:16";
  links?: ManhuaPrevisCharacterLink[];
  /** 运镜风格档；省略 = 硬桥硬马 */
  cameraStyle?: ManhuaCameraStyle;
}): ManhuaPrevisDraftFromPlan {
  const { plan, shot } = input;
  const timing = manhuaPrevisTimingForExecutableShot(shot, input.resolvedCamera ?? null);
  const summaryZh: string[] = [];
  const issuesZh: string[] = timing.issues.map((i) => i.messageZh);
  const D = timing.durationSec;
  const snapshot = compileManhuaShotSnapshot(plan, shot.sourceShotId) ?? {};
  const nameOf = (id: string) => plan.actors.find((a) => a.actorId === id)?.nameZh ?? id;
  const linkOf = (id: string) => input.links?.find((l) => l.actorId === id);

  const onstage = shot.onstageActorIds;
  if (onstage.length > 6) issuesZh.push(`在场 ${onstage.length} 人，白模一段最多 6 人，请回拆镜器再拆`);
  const formation = defaultFormation(onstage.length);
  const actors: ManhuaPrevisSpec["actors"] = onstage.slice(0, 6).map((actorId, i) => {
    const st = snapshot[actorId];
    const link = linkOf(actorId);
    const focus = st?.focusActorId ? onstage.indexOf(st.focusActorId) : -1;
    const f = formation[i]!;
    const facingDeg = focus >= 0 ? (formation[focus]!.start[0] >= f.start[0] ? 0 : 180) : f.facingDeg;
    const armed = Boolean(st?.heldProps?.length);
    return {
      id: actorId,
      nameZh: nameOf(actorId),
      ...(link?.assetRef ? { assetRef: link.assetRef } : {}),
      ...(armed ? { weapon: "practice_sword" as const } : {}),
      shape: link?.shape ?? "human",
      start: f.start,
      end: f.start,
      moveStartSec: 0,
      moveEndSec: D,
      facingDeg,
      actions: [],
    };
  });
  summaryZh.push(`在场 ${actors.map((a) => a.nameZh).join("、")}；站位为默认排布，面朝各自对手`);
  if (shot.offstage.length) {
    summaryZh.push(`画外：${shot.offstage.map((o) => `${nameOf(o.actorId)}（${o.whereaboutsZh || o.presence}）`).join("、")}`);
  }

  // 交锋：attack 事件 → 白模互动；受方持械 → 剑格挡，否则按结果选后缩/格挡
  const interactions: NonNullable<ManhuaPrevisSpec["interactions"]> = [];
  const cueById = new Map(timing.contactCues.map((c) => [c.eventId, c] as const));
  for (const e of shot.events) {
    if (e.kind !== "attack") continue;
    const cue = cueById.get(e.eventId);
    if (!cue) continue;
    if (!onstage.includes(e.targetActorId)) {
      issuesZh.push(`${nameOf(e.actorId)} 出招的对手 ${nameOf(e.targetActorId)} 不在本镜在场名单，白模无法表现`);
      continue;
    }
    const targetArmed = Boolean(snapshot[e.targetActorId]?.heldProps?.length);
    const kind = targetArmed ? "sword_guard" : e.outcome === "hit" ? "strike_recoil" : "strike_guard";
    // 接触前后各留 ≥¼ 秒（白模合同）；接触点本身先吸附到帧
    const contactSec = fr(clamp(cue.contactSec, QUARTER, D - QUARTER));
    const startSec = fr(clamp(Math.min(cue.windupStartSec, contactSec - QUARTER), 0, contactSec - QUARTER));
    const endSec = fr(clamp(Math.max(cue.recoverEndSec, contactSec + QUARTER), contactSec + QUARTER, D));
    interactions.push({ id: e.eventId, kind, actorId: e.actorId, targetActorId: e.targetActorId, startSec, contactSec, endSec });
    summaryZh.push(
      `${cue.contactSec.toFixed(1)}s ${nameOf(e.actorId)} → ${nameOf(e.targetActorId)}：${kind === "sword_guard" ? "剑格挡" : kind === "strike_recoil" ? "命中后缩" : "抬手格挡"}` +
        (e.slowMotionIntent ? "（慢看）" : ""),
    );
  }

  // 出水：emerge 事件 → 浪花预演（只在出水镜）
  let waterEmergence: ManhuaPrevisSpec["waterEmergence"];
  const emerges = shot.events.filter((e): e is Extract<ManhuaActionEvent, { kind: "emerge" }> => e.kind === "emerge");
  if (emerges.length) {
    const events = emerges.slice(0, 3).map((e) => {
      const cue = cueById.get(e.eventId);
      const cross = fr(clamp(cue?.contactSec ?? 1, 0.5, D));
      const rise = fr(clamp(cross - (cue?.windupStartSec ?? 0), 0.5, 3));
      return { actorId: e.actorId, crossSec: cross, riseSec: rise, height: 2, waveRadius: 1.2, waveHeight: 1, waveDurationSec: 1.5 };
    });
    const allSame = events.every((ev) => Math.abs(ev.crossSec - events[0]!.crossSec) < 1e-6);
    waterEmergence = { mode: allSame ? "simultaneous" : "staggered", events };
    summaryZh.push(`出水：${events.map((ev) => `${nameOf(ev.actorId)} ${ev.crossSec.toFixed(1)}s`).join("、")}（${allSame ? "同时冲出" : "错峰冲出"}，各自独立浪花）`);
    if (emerges.length > 3) issuesZh.push(`出水 ${emerges.length} 人超过白模上限 3 人`);
  }

  // 相机：按武打运镜文法从动作事件编排（≤8 切镜，源秒对齐 24 帧）；无事件时退回默认全景
  const actorPositions: Record<string, [number, number]> = {};
  for (const a of actors) actorPositions[a.id] = a.start;
  const choreo = choreographManhuaCameras({ durationSec: D, events: shot.events, cues: timing.contactCues, actorPositions, style: input.cameraStyle });
  const cameras: ManhuaPrevisSpec["cameras"] = choreo.cameras.map(({ startSec, endSec, position, target, lens }) => ({ startSec, endSec, position, target, lens }));
  summaryZh.push(`运镜 ${cameras.length} 镜（按接触点切）：` + choreo.cameras.map(manhuaCameraPromptZh).join("；"));
  for (const n of choreo.notesZh) summaryZh.push(n);
  if (timing.padSec > 0) summaryZh.push(`源区间 ${(D - timing.padSec).toFixed(1)}s 取整为 ${D}s，末尾补 ${timing.padSec.toFixed(2)}s 待机`);

  const candidate = {
    version: 1 as const,
    durationSec: D,
    aspect: input.aspect,
    actors,
    ...(interactions.length ? { interactions } : {}),
    ...(waterEmergence ? { waterEmergence } : {}),
    cameras,
  };
  const parsed = manhuaPrevisSpecSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const i of parsed.error.issues) issuesZh.push(`${i.path.join(".") || "(根)"}：${i.message}`);
  }
  return {
    executableShotId: shot.executableShotId,
    sourceShotId: shot.sourceShotId,
    kind: shot.kind,
    timing,
    spec: parsed.success ? parsed.data : null,
    summaryZh,
    issuesZh,
  };
}
