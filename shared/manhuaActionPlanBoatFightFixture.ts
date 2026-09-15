/**
 * 测试夹具：四人船战动作计划（拆镜器 / 执行准备 / 时间轴共用）。
 * 不是生产代码；只从测试导入。
 */
import { sealManhuaActionPlan, type ManhuaActionPlan, type ManhuaPlanShot } from "./manhuaActionPlan";

export const MAN = "ap_actor_man", WOMAN = "ap_actor_woman", A = "ap_actor_ambush_a", B = "ap_actor_ambush_b";
export const boatFightActors = [
  { actorId: MAN, nameZh: "男", canonAnchorId: "wa_char_nan1a2b" },
  { actorId: WOMAN, nameZh: "女", canonAnchorId: "wa_char_nv3c4d" },
  { actorId: A, nameZh: "伏兵甲" },
  { actorId: B, nameZh: "伏兵乙" },
];
const screen = (x: number, y: number) => ({ space: "screen" as const, x, y });
const facing = (deg: number) => ({ basis: "screen_deg" as const, deg });
const plainMap = (sourceDurationSec: number) => ({ sourceDurationSec, spans: [] });
const sword = { propAnchorId: "wa_prop_sword", socket: "right_hand" as const };
const landing = (shotIndex: number, landingId: string) => ({
  overlayRef: { episodeIndex: 1, segmentIndex: 1, shotIndex },
  landingId, sourceRevision: "overlay-1a2b3c4d", surfaceRef: "surf_deck_main", surfaceZh: "甲板",
});
export const phases = (a: number, b: number) => [
  { kind: "windup" as const, sourceStartSec: a, sourceEndSec: a + (b - a) / 3 },
  { kind: "contact" as const, sourceStartSec: a + (b - a) / 3, sourceEndSec: a + (2 * (b - a)) / 3 },
  { kind: "recover" as const, sourceStartSec: a + (2 * (b - a)) / 3, sourceEndSec: b },
];

/**
 * 四人船战：
 *   镜1 男女交锋（伏兵 not_entered）
 *   镜2 两伏兵出水（0–4s），男女在场观望
 *   镜3 伏兵登船落甲板 + 男→甲、女→乙 交锋
 */
export type BoatFightOverrides = { shot2DurationSec?: number; emergeEnd?: number; extraEmerge?: boolean; withSourceBindings?: boolean };
export function buildBoatFight(over?: BoatFightOverrides): ManhuaActionPlan {
  const emergeEnd = over?.emergeEnd ?? 4;
  const shots: ManhuaPlanShot[] = [
    {
      shotId: "ap_shot_1", displayIndex: 1, timeMap: plainMap(6), confirm: "confirmed", actorChanges: [],
      events: [
        { eventId: "ap_evt_1a", kind: "attack", actorId: MAN, targetActorId: WOMAN, phases: phases(0, 2), outcome: "blocked", slowMotionIntent: false },
        { eventId: "ap_evt_1b", kind: "attack", actorId: WOMAN, targetActorId: MAN, phases: phases(2, 4), outcome: "blocked", slowMotionIntent: false },
      ],
    },
    {
      shotId: "ap_shot_2", displayIndex: 2, timeMap: plainMap(over?.shot2DurationSec ?? 6), confirm: "confirmed",
      actorChanges: [
        { actorId: A, next: { presence: "onstage", at: screen(0.8, 0.9), facing: facing(180), heldProps: [] } },
        { actorId: B, next: { presence: "onstage", at: screen(0.85, 0.9), facing: facing(180), heldProps: [] } },
        { actorId: MAN, next: { heldProps: [] } },
        { actorId: WOMAN, next: { heldProps: [] } },
      ],
      events: [
        { eventId: "ap_evt_2a", kind: "emerge", actorId: A, phases: phases(0, emergeEnd), outcome: "emerged", slowMotionIntent: true },
        { eventId: "ap_evt_2b", kind: "emerge", actorId: B, phases: phases(0.5, emergeEnd), outcome: "emerged", slowMotionIntent: true },
        ...(over?.extraEmerge ? [{ eventId: "ap_evt_2c", kind: "emerge" as const, actorId: MAN, phases: phases(0, emergeEnd), outcome: "emerged" as const, slowMotionIntent: false }] : []),
        { eventId: "ap_evt_2o", kind: "observe", actorId: MAN, subjectActorId: A, phases: phases(1, 5), outcome: "observed", slowMotionIntent: false },
      ],
    },
    {
      shotId: "ap_shot_3", displayIndex: 3, timeMap: plainMap(8), confirm: "confirmed",
      actorChanges: [
        { actorId: A, next: { at: screen(0.6, 0.6), heldProps: [sword], focusActorId: MAN } },
        { actorId: B, next: { at: screen(0.4, 0.6), heldProps: [sword], focusActorId: WOMAN } },
        { actorId: MAN, next: { heldProps: [sword], focusActorId: A } },
        { actorId: WOMAN, next: { heldProps: [sword], focusActorId: B } },
      ],
      events: [
        { eventId: "ap_evt_3l1", kind: "land", actorId: A, landing: landing(3, "lp_deck_port"), phases: phases(0, 1), outcome: "landed", slowMotionIntent: false },
        { eventId: "ap_evt_3l2", kind: "land", actorId: B, landing: landing(3, "lp_deck_stbd"), phases: phases(0, 1), outcome: "landed", slowMotionIntent: false },
        { eventId: "ap_evt_3a", kind: "attack", actorId: MAN, targetActorId: A, phases: phases(1, 4), outcome: "blocked", slowMotionIntent: false },
        { eventId: "ap_evt_3b", kind: "attack", actorId: WOMAN, targetActorId: B, phases: phases(2, 5), outcome: "blocked", slowMotionIntent: false },
      ],
    },
  ];
  if (over?.withSourceBindings) {
    for (const s of shots) {
      s.sourceBinding = { episodeIndex: 1, segmentIndex: 1, sourceShotIndex: s.displayIndex, sourceRevision: "overlay-1a2b3c4d" };
      s.camera = { source: "previs_cameras", sourceShotRef: `previs-${s.displayIndex}`, sourceRevision: "pv-1", timeBasis: "source", timedSamplesResolved: true };
    }
  }
  return sealManhuaActionPlan({
    actionPlanId: "ap_boat_fight",
    episodeIndex: 1,
    actors: boatFightActors,
    initialStates: {
      [MAN]: { presence: "onstage", at: screen(0.3, 0.7), facing: facing(0), heldProps: [sword] },
      [WOMAN]: { presence: "onstage", at: screen(0.7, 0.7), facing: facing(180), heldProps: [sword] },
      [A]: { presence: "not_entered", heldProps: [], whereaboutsZh: "水下埋伏" },
      [B]: { presence: "not_entered", heldProps: [], whereaboutsZh: "水下埋伏" },
    },
    shots,
    executionRanges: [],
  });
}

