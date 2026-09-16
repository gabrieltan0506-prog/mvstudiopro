import { describe, expect, it } from "vitest";
import { buildBoatFight, A, B, MAN, WOMAN } from "./manhuaActionPlanBoatFightFixture";
import { splitManhuaActionPlanForPrevis } from "./manhuaActionPlanSplit";
import { manhuaPrevisTimingForExecutableShot } from "./manhuaPrevisTiming";
import { manhuaPrevisSpecSchema } from "./manhuaPrevis";
import { manhuaPrevisDraftFromExecutableShot } from "./manhuaPrevisFromActionPlan";
import { CONTACT_LEAD_FRAMES, MANHUA_CAMERA_MAX_CUTS, assessManhuaCameraVariety, choreographManhuaCameras, manhuaCameraPromptZh, type ManhuaChoreographedCamera } from "./manhuaCameraGrammar";
import { resolveManhuaCameraTempo } from "./manhuaCameraTempo";
import type { ManhuaActionEvent } from "./manhuaActionPlan";

const plan = buildBoatFight();
const { shots } = splitManhuaActionPlanForPrevis(plan);
const positions = { [MAN]: [-1.25, 0] as [number, number], [WOMAN]: [1.25, 0] as [number, number], [A]: [-2, 0] as [number, number], [B]: [2, 0] as [number, number] };
const cam = (endSec: number) => ({ source: "previs_cameras" as const, sourceShotRef: "pv", sourceRevision: "r", coverage: { startSec: 0, endSec }, coverageBasis: "source" as const, sampling: { kind: "discrete" as const, fps: 24 }, timedSamplesAvailable: true });

describe("武打运镜文法 → 白模相机", () => {
  it("镜1 两次交锋：每次接触都有仰角接触镜且切在接触前 5 帧；接触后有受方反应特写；连续覆盖 0–D、≤8 镜", () => {
    const shot = shots.find((s) => s.sourceShotId === "ap_shot_1")!;
    const timing = manhuaPrevisTimingForExecutableShot(shot, cam(6));
    const { cameras } = choreographManhuaCameras({ durationSec: timing.durationSec, events: shot.events, cues: timing.contactCues, actorPositions: positions });
    expect(cameras.length).toBeLessThanOrEqual(MANHUA_CAMERA_MAX_CUTS);
    expect(cameras[0]!.startSec).toBe(0);
    expect(cameras[cameras.length - 1]!.endSec).toBe(timing.durationSec);
    for (let i = 1; i < cameras.length; i += 1) expect(cameras[i]!.startSec).toBeCloseTo(cameras[i - 1]!.endSec, 9);
    const contacts = cameras.filter((c) => c.kind === "contact");
    expect(contacts.map((c) => c.eventId)).toEqual(["ap_evt_1a", "ap_evt_1b"]);
    for (const c of contacts) {
      const cue = timing.contactCues.find((q) => q.eventId === c.eventId)!;
      const lead = cue.contactSec - CONTACT_LEAD_FRAMES / 24;
      // 首镜前空档不足半秒时并入首镜（必须从 0 覆盖），否则精确切在接触前 5 帧
      expect(c.startSec).toBeCloseTo(lead < 0.5 ? 0 : Math.round(lead * 24) / 24, 6);
      expect(c.position[2]).toBeLessThan(0.9); // 仰角：机位低于胸高
      expect(c.lens).toBe(45);
    }
    expect(cameras.some((c) => c.kind === "reaction" && c.lens === 55)).toBe(true);
    // 绝不连续两镜同景别同机位
    for (let i = 1; i < cameras.length; i += 1) expect(cameras[i]!.position).not.toEqual(cameras[i - 1]!.position);
  });

  it("出水镜：低机位仰拍 → 落点俯拍", () => {
    const shot = shots.find((s) => s.kind === "water_emerge")!;
    const timing = manhuaPrevisTimingForExecutableShot(shot, cam(6));
    const { cameras } = choreographManhuaCameras({ durationSec: timing.durationSec, events: shot.events, cues: timing.contactCues, actorPositions: positions });
    expect(cameras.some((c) => c.kind === "emerge_low" && c.position[2] < 0.9)).toBe(true);
    expect(cameras.some((c) => c.kind === "land_high" && c.position[2] > 3)).toBe(true);
  });

  it("斗法档：施法起手手部特写（lens 55）、命中镜在受方侧低机位全景（lens 32）；反应特写仍在", () => {
    const shot = shots.find((s) => s.sourceShotId === "ap_shot_1")!;
    const timing = manhuaPrevisTimingForExecutableShot(shot, cam(6));
    // 用首事件 1a 当斗法：起手 0→1.0s（≥ 半秒才有起手镜，且不被前一事件的反应特写挤掉）
    const cues = timing.contactCues.map((c) => (c.eventId === "ap_evt_1a" ? { ...c, windupStartSec: 0, contactSec: 1.0, recoverEndSec: 2.0 } : c));
    const { cameras } = choreographManhuaCameras({ durationSec: timing.durationSec, events: shot.events, cues, actorPositions: positions, eventManner: { ap_evt_1a: "ranged" } });
    const spell = cameras.find((c) => c.kind === "contact" && c.eventId === "ap_evt_1a")!;
    expect(spell.lens).toBe(32);
    expect(spell.position[2]).toBeLessThan(0.9);
    // 命中镜机位靠受方（WOMAN 在 +1.25）而不是攻方（MAN 在 -1.25）
    expect(spell.position[0]).toBeGreaterThan(0);
    const melee = cameras.find((c) => c.kind === "contact" && c.eventId === "ap_evt_1b")!;
    expect(melee.lens).toBe(45);
    expect(cameras.some((c) => c.kind === "windup" && c.eventId === "ap_evt_1a" && c.lens === 55)).toBe(true);
    expect(cameras.filter((c) => c.kind === "reaction").length).toBeGreaterThan(0);
  });

  it("无事件 → 单一默认全景；镜数超上限 → 丢最低优先级并写明", () => {
    const empty = choreographManhuaCameras({ durationSec: 4, events: [], cues: [], actorPositions: positions });
    expect(empty.cameras).toHaveLength(1);
    expect(empty.cameras[0]!.kind).toBe("establish");
    const shot = shots.find((s) => s.sourceShotId === "ap_shot_3")!;
    const timing = manhuaPrevisTimingForExecutableShot(shot, cam(8));
    const capped = choreographManhuaCameras({ durationSec: timing.durationSec, events: shot.events, cues: timing.contactCues, actorPositions: positions, maxCuts: 3 });
    expect(capped.cameras).toHaveLength(3);
    expect(capped.notesZh.some((n) => n.includes("镜数超过 3"))).toBe(true);
    expect(capped.cameras.filter((c) => c.kind === "contact").length).toBeGreaterThan(0);
  });

  it("接进白模草案：相机来自文法且过生产 schema；摘要含每镜运镜提示词", () => {
    const shot = shots.find((s) => s.sourceShotId === "ap_shot_3")!;
    const d = manhuaPrevisDraftFromExecutableShot({ plan, shot, resolvedCamera: cam(8), aspect: "16:9" });
    expect(d.spec).not.toBeNull();
    expect(manhuaPrevisSpecSchema.safeParse(d.spec).success).toBe(true);
    expect(d.spec!.cameras.length).toBeGreaterThanOrEqual(4);
    expect(d.spec!.cameras[d.spec!.cameras.length - 1]!.endSec).toBe(d.spec!.durationSec);
    expect(d.summaryZh.some((s) => s.startsWith("运镜") && s.includes("仰角"))).toBe(true);
  });
});

/** 相机合同（与 manhuaPrevisSpecSchema 的 cameras 校验同口径）：首镜 0、连续、末镜 D、≤8、每镜 ≥1 帧、帧对齐、机位≠目标（≥0.5）、lens 18–65 整数、坐标在舞台内 */
function assertCameraContract(cameras: ReturnType<typeof choreographManhuaCameras>["cameras"], D: number) {
  expect(cameras.length).toBeGreaterThanOrEqual(1);
  expect(cameras.length).toBeLessThanOrEqual(MANHUA_CAMERA_MAX_CUTS);
  expect(cameras[0]!.startSec).toBe(0);
  expect(cameras[cameras.length - 1]!.endSec).toBe(D);
  for (let i = 0; i < cameras.length; i += 1) {
    const c = cameras[i]!;
    if (i > 0) expect(c.startSec).toBeCloseTo(cameras[i - 1]!.endSec, 9);
    expect(Math.round(c.endSec * 24)).toBeGreaterThan(Math.round(c.startSec * 24));
    expect(Math.abs(c.startSec * 24 - Math.round(c.startSec * 24))).toBeLessThan(1e-6);
    expect(Math.abs(c.endSec * 24 - Math.round(c.endSec * 24))).toBeLessThan(1e-6);
    expect(Math.hypot(...c.position.map((n, j) => n - c.target[j]!))).toBeGreaterThanOrEqual(0.5);
    expect(Number.isInteger(c.lens) && c.lens >= 18 && c.lens <= 65).toBe(true);
    for (const p of [c.position, c.target]) {
      expect(Math.abs(p[0])).toBeLessThanOrEqual(30);
      expect(Math.abs(p[1])).toBeLessThanOrEqual(30);
      expect(p[2]).toBeGreaterThanOrEqual(0.2);
      expect(p[2]).toBeLessThanOrEqual(15);
    }
  }
}

describe("1470 R1 · 属性式：随机事件密度下相机合同恒成立", () => {
  // 确定性 LCG，失败可复现
  const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const base = shots.find((s) => s.sourceShotId === "ap_shot_1")!;

  it("10 组随机 phases（1–8 次交锋、随机时长、随机攻受、随机 melee/ranged、随机站位含同点）全部满足合同", () => {
    for (let round = 0; round < 10; round += 1) {
      const rnd = lcg(1000 + round);
      const D = [2, 4, 6, 8, 12][Math.floor(rnd() * 5)]!;
      const n = 1 + Math.floor(rnd() * 8);
      const events: ManhuaActionEvent[] = [];
      for (let i = 0; i < n; i += 1) {
        const start = Math.round(rnd() * (D - 0.2) * 24) / 24;
        const w = Math.round((0.02 + rnd() * 1.2) * 24) / 24;
        const c = Math.round((0.02 + rnd() * 0.6) * 24) / 24;
        const r = Math.round((0.02 + rnd() * 1.5) * 24) / 24;
        const end = Math.min(D, start + w + c + r);
        const cs = Math.min(end, start + w);
        const ce = Math.min(end, cs + c);
        const [atk, tgt] = rnd() < 0.5 ? [MAN, WOMAN] : [WOMAN, MAN];
        events.push({
          eventId: `r${round}_e${i}`, kind: "attack", actorId: atk, targetActorId: tgt, outcome: "unplanned", slowMotionIntent: false,
          phases: [
            { kind: "windup", sourceStartSec: start, sourceEndSec: cs },
            { kind: "contact", sourceStartSec: cs, sourceEndSec: ce },
            { kind: "recover", sourceStartSec: ce, sourceEndSec: end },
          ].filter((p) => p.sourceEndSec > p.sourceStartSec) as ManhuaActionEvent["phases"],
        } as ManhuaActionEvent);
      }
      const shot = { ...base, sourceSpan: { startSec: 0, endSec: D }, timeMap: { sourceDurationSec: D, spans: [] }, events };
      const timing = manhuaPrevisTimingForExecutableShot(shot, cam(D));
      const samePoint = rnd() < 0.3;
      const actorPositions = samePoint
        ? { [MAN]: [0, 0] as [number, number], [WOMAN]: [0, 0] as [number, number] }
        : { [MAN]: [-1 - rnd() * 3, rnd() * 2 - 1] as [number, number], [WOMAN]: [1 + rnd() * 3, rnd() * 2 - 1] as [number, number] };
      const eventManner = Object.fromEntries(events.map((e) => [e.eventId, rnd() < 0.4 ? "ranged" : "melee"] as const));
      const { cameras } = choreographManhuaCameras({ durationSec: timing.durationSec, events, cues: timing.contactCues, actorPositions, eventManner });
      assertCameraContract(cameras, timing.durationSec);
    }
  });

  it("攻受同点（距离 0）：不出 NaN，机位与目标仍分开（≥0.5），仰角接触镜仍在", () => {
    const shot = base;
    const timing = manhuaPrevisTimingForExecutableShot(shot, cam(6));
    const { cameras } = choreographManhuaCameras({
      durationSec: timing.durationSec, events: shot.events, cues: timing.contactCues,
      actorPositions: { [MAN]: [0.5, 0.5], [WOMAN]: [0.5, 0.5] },
      eventManner: { ap_evt_1a: "ranged", ap_evt_1b: "melee" },
    });
    assertCameraContract(cameras, timing.durationSec);
    for (const c of cameras) for (const v of [...c.position, ...c.target]) expect(Number.isFinite(v)).toBe(true);
    expect(cameras.filter((c) => c.kind === "contact")).toHaveLength(2);
  });

  it("接触前 5 帧的失真上界：首镜空档 <0.5s（<12 帧）时接触镜从 0 起，提前量最多 16 帧（0.67s，接触在第 16 帧时）；空档 ≥12 帧时精确 5 帧", () => {
    const mk = (contactSec: number) => {
      const events: ManhuaActionEvent[] = [{
        eventId: "lead", kind: "attack", actorId: MAN, targetActorId: WOMAN, outcome: "unplanned", slowMotionIntent: false,
        phases: [
          { kind: "windup", sourceStartSec: Math.max(0, contactSec - 0.1), sourceEndSec: contactSec },
          { kind: "contact", sourceStartSec: contactSec, sourceEndSec: contactSec + 0.1 },
          { kind: "recover", sourceStartSec: contactSec + 0.1, sourceEndSec: contactSec + 0.6 },
        ],
      } as ManhuaActionEvent];
      const shot = { ...base, sourceSpan: { startSec: 0, endSec: 6 }, timeMap: { sourceDurationSec: 6, spans: [] }, events };
      const timing = manhuaPrevisTimingForExecutableShot(shot, cam(6));
      const { cameras } = choreographManhuaCameras({ durationSec: 6, events, cues: timing.contactCues, actorPositions: positions });
      const contact = cameras.find((c) => c.kind === "contact")!;
      return Math.round((timing.contactCues[0]!.contactSec - contact.startSec) * 24);
    };
    expect(mk(0.3)).toBe(7);        // 接触第 7 帧：并到 0，提前 7 帧
    expect(mk(16 / 24)).toBe(16);   // 最坏：接触第 16 帧 → 接触镜起点 11 帧 <12 帧被并到 0，提前 16 帧（0.67s）
    expect(mk(17 / 24)).toBe(5);    // 接触第 17 帧 → 起点 12 帧 = 半秒空档，建立镜 0–0.5s，接触镜精确提前 5 帧
    expect(mk(3)).toBe(5);
  });
});

describe("1470 R2 · 边界穷举", () => {
  const base = shots.find((s) => s.sourceShotId === "ap_shot_1")!;
  const one = (contactSec: number, D: number): ManhuaActionEvent[] => [{
    eventId: "edge", kind: "attack", actorId: MAN, targetActorId: WOMAN, outcome: "unplanned", slowMotionIntent: false,
    phases: [
      { kind: "windup", sourceStartSec: Math.max(0, contactSec - 0.2), sourceEndSec: contactSec },
      { kind: "contact", sourceStartSec: contactSec, sourceEndSec: Math.min(D, contactSec + 0.1) },
      { kind: "recover", sourceStartSec: Math.min(D, contactSec + 0.1), sourceEndSec: D },
    ].filter((p) => p.sourceEndSec > p.sourceStartSec) as ManhuaActionEvent["phases"],
  } as ManhuaActionEvent];
  const run = (events: ManhuaActionEvent[], D: number, maxCuts?: number) => {
    const shot = { ...base, sourceSpan: { startSec: 0, endSec: D }, timeMap: { sourceDurationSec: D, spans: [] }, events };
    const timing = manhuaPrevisTimingForExecutableShot(shot, cam(D));
    return choreographManhuaCameras({ durationSec: timing.durationSec, events, cues: timing.contactCues, actorPositions: positions, maxCuts });
  };
  it("最短段 D=2：接触贴在片尾 / 贴在片头，都连续覆盖且每镜 ≥1 帧", () => {
    assertCameraContract(run(one(2, 2), 2).cameras, 2);
    assertCameraContract(run(one(0, 2), 2).cameras, 2);
    assertCameraContract(run(one(1, 2), 2).cameras, 2);
  });
  it("maxCuts=1：只剩一镜仍覆盖 0–D；maxCuts=2 与 8 均连续", () => {
    const shot3 = shots.find((s) => s.sourceShotId === "ap_shot_3")!;
    const timing = manhuaPrevisTimingForExecutableShot(shot3, cam(8));
    for (const max of [1, 2, 8]) {
      const { cameras } = choreographManhuaCameras({ durationSec: timing.durationSec, events: shot3.events, cues: timing.contactCues, actorPositions: positions, maxCuts: max });
      expect(cameras.length).toBeLessThanOrEqual(max);
      assertCameraContract(cameras, timing.durationSec);
    }
  });
  it("单事件 evade（无接触镜生成）与只有 observe：退回默认全景，仍满足合同", () => {
    const evade: ManhuaActionEvent[] = [{ eventId: "ev", kind: "evade", actorId: MAN, threatActorId: WOMAN, outcome: "unplanned", slowMotionIntent: false,
      phases: [{ kind: "windup", sourceStartSec: 1, sourceEndSec: 1.5 }, { kind: "contact", sourceStartSec: 1.5, sourceEndSec: 2 }] } as ManhuaActionEvent];
    assertCameraContract(run(evade, 4).cameras, 4);
    const observe: ManhuaActionEvent[] = [{ eventId: "ob", kind: "observe", actorId: MAN, subjectActorId: WOMAN, outcome: "observed", slowMotionIntent: false,
      phases: [{ kind: "windup", sourceStartSec: 0, sourceEndSec: 3 }] } as ManhuaActionEvent];
    assertCameraContract(run(observe, 4).cameras, 4);
  });
});

describe("PR-6 · 节奏档接进运镜文法（属性式）", () => {
  const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const base = shots.find((s) => s.sourceShotId === "ap_shot_1")!;
  const randomShot = (rnd: () => number) => {
    const D = [4, 6, 8, 12][Math.floor(rnd() * 4)]!;
    const n = 1 + Math.floor(rnd() * 6);
    const events: ManhuaActionEvent[] = [];
    // 事件按序不交叠（交叠事件的裁切由 1470 属性测试覆盖；这里验节奏档的停留/上限）
    let clock = Math.round(rnd() * 1.5 * 24) / 24;
    for (let i = 0; i < n && clock < D - 0.5; i += 1) {
      const start = clock;
      const w = Math.round((0.1 + rnd() * 1) * 24) / 24;
      const c = Math.round((0.05 + rnd() * 0.5) * 24) / 24;
      const r = Math.round((0.1 + rnd() * 1.5) * 24) / 24;
      const end = Math.min(D, start + w + c + r);
      clock = end + Math.round(rnd() * 1 * 24) / 24;
      const cs = Math.min(end, start + w);
      const ce = Math.min(end, cs + c);
      const [atk, tgt] = rnd() < 0.5 ? [MAN, WOMAN] : [WOMAN, MAN];
      events.push({
        eventId: `t_e${i}`, kind: "attack", actorId: atk, targetActorId: tgt, outcome: "unplanned", slowMotionIntent: false,
        phases: [
          { kind: "windup", sourceStartSec: start, sourceEndSec: cs },
          { kind: "contact", sourceStartSec: cs, sourceEndSec: ce },
          { kind: "recover", sourceStartSec: ce, sourceEndSec: end },
        ].filter((p) => p.sourceEndSec > p.sourceStartSec) as ManhuaActionEvent["phases"],
      } as ManhuaActionEvent);
    }
    const shot = { ...base, sourceSpan: { startSec: 0, endSec: D }, timeMap: { sourceDurationSec: D, spans: [] }, events };
    const timing = manhuaPrevisTimingForExecutableShot(shot, cam(D));
    return { D: timing.durationSec, events, cues: timing.contactCues };
  };

  it("快档（有接触）：合同恒成立、≤8 镜、反应镜至少停 1s（被下一个接触镜切掉或到片尾除外；空档沿用上一镜是既有规则）", () => {
    const tempo = resolveManhuaCameraTempo({ intentZh: "燃", hasContact: true });
    for (let round = 0; round < 12; round += 1) {
      const { D, events, cues } = randomShot(lcg(7000 + round));
      const { cameras } = choreographManhuaCameras({ durationSec: D, events, cues, actorPositions: positions, tempo });
      assertCameraContract(cameras, D);
      expect(cameras.length).toBeLessThanOrEqual(tempo.maxCuts);
      cameras.forEach((c, i) => {
        const next = cameras[i + 1];
        if (c.kind !== "reaction" || !next || next.kind === "contact" || next.kind === "reaction") return; // 交叠事件的接触/反应镜可切掉前一反应镜
        expect(c.endSec - c.startSec + 1e-9).toBeGreaterThanOrEqual(Math.min(tempo.reactionHoldSec, D - c.startSec) - 1 / 24);
      });
    }
  });

  it("慢档（慢环绕）：≤3 镜、建立镜 ≥ min(3s, 首个接触镜起点)、接触镜不被推迟、合同恒成立", () => {
    const tempo = resolveManhuaCameraTempo({ intentZh: "静", hasContact: false });
    expect(tempo.style).toBe("slow_orbit");
    for (let round = 0; round < 12; round += 1) {
      const { D, events, cues } = randomShot(lcg(9000 + round));
      const plain = choreographManhuaCameras({ durationSec: D, events, cues, actorPositions: positions }).cameras;
      const { cameras, notesZh } = choreographManhuaCameras({ durationSec: D, events, cues, actorPositions: positions, tempo });
      assertCameraContract(cameras, D);
      expect(cameras.length).toBeLessThanOrEqual(3);
      const firstContact = plain.find((c) => c.kind === "contact");
      const est = cameras[0]!;
      if (est.kind === "establish") {
        const limit = Math.min(firstContact ? firstContact.startSec : D - 1 / 24, tempo.minShotSec);
        expect(est.endSec + 1e-9).toBeGreaterThanOrEqual(Math.min(limit, D));
        expect(manhuaCameraPromptZh(est, tempo.style)).toContain("慢环绕");
      }
      const contact = cameras.find((c) => c.kind === "contact");
      if (contact && firstContact && contact.eventId === firstContact.eventId) expect(contact.startSec).toBeLessThanOrEqual(firstContact.startSec + 1e-9);
      expect(notesZh.some((n) => n.includes("慢环绕"))).toBe(true);
    }
  });

  it("反应镜停留可调：hold 2s 时反应镜 ≈2s；导演卡非人角色 → 反应给非人攻方、lens 55", () => {
    const shot = base;
    const timing = manhuaPrevisTimingForExecutableShot(shot, cam(6));
    // 1a 接触 1.0s、1b 接触 4.5s：反应镜有 2s 空间，再长就撞上 1b 的接触镜
    const cues = timing.contactCues.map((c) => (c.eventId === "ap_evt_1a" ? { ...c, windupStartSec: 0, contactSec: 1.0, recoverEndSec: 2.0 } : { ...c, windupStartSec: 4.0, contactSec: 4.5, recoverEndSec: 5.5 }));
    // 两次交锋：1a 的反应镜被 1b 顶住；hold 越长反应镜结束点越晚（直到被 1b 的接触镜切掉）
    const endWith = (hold: number) => {
      const { cameras } = choreographManhuaCameras({ durationSec: timing.durationSec, events: shot.events, cues, actorPositions: positions, tempo: { reactionHoldSec: hold, maxCuts: 8 } });
      return cameras.find((c) => c.kind === "reaction" && c.eventId === "ap_evt_1a")!;
    };
    const long = endWith(2);
    const contact1b = cues.find((c) => c.eventId === "ap_evt_1b")!.contactSec - 5 / 24;
    expect(long).toBeTruthy();
    expect(long.endSec - long.startSec + 1e-9).toBeGreaterThanOrEqual(Math.min(2, contact1b - long.startSec) - 1 / 24);
    // 反应镜停留再长也不能吞掉下一个接触镜（接触优先级最高）
    const longAll = choreographManhuaCameras({ durationSec: timing.durationSec, events: shot.events, cues, actorPositions: positions, tempo: { reactionHoldSec: 2, maxCuts: 8 } }).cameras;
    const c1b = longAll.find((c) => c.kind === "contact" && c.eventId === "ap_evt_1b")!;
    expect(c1b).toBeTruthy();
    expect(c1b.startSec).toBeCloseTo(Math.round(contact1b * 24) / 24, 6);
    const evt = shot.events[0] as Extract<ManhuaActionEvent, { kind: "attack" }>;
    const nh = choreographManhuaCameras({ durationSec: timing.durationSec, events: shot.events.slice(0, 1), cues, actorPositions: positions, tempo: { reactionToNonHuman: true, reactionLens: 55 }, nonHumanActorIds: [evt.actorId] });
    const rr = nh.cameras.find((c) => c.kind === "reaction")!;
    expect(rr.noteZh).toContain(evt.actorId);
    expect(rr.noteZh).toContain("非人");
    expect(rr.lens).toBe(55);
  });

  it("手持档：切点与硬切相同，只多一条标注；提示词句带「手持」", () => {
    const shot = base;
    const timing = manhuaPrevisTimingForExecutableShot(shot, cam(6));
    const hard = choreographManhuaCameras({ durationSec: timing.durationSec, events: shot.events, cues: timing.contactCues, actorPositions: positions });
    const hand = choreographManhuaCameras({ durationSec: timing.durationSec, events: shot.events, cues: timing.contactCues, actorPositions: positions, tempo: { style: "handheld" } });
    expect(hand.cameras.map((c) => [c.startSec, c.endSec])).toEqual(hard.cameras.map((c) => [c.startSec, c.endSec]));
    expect(hand.notesZh.some((n) => n.includes("手持"))).toBe(true);
    expect(manhuaCameraPromptZh(hand.cameras[0]!, "handheld")).toContain("手持");
  });
});

describe("1471 R1 · 属性式：布局改动不丢接触镜", () => {
  const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const base = shots.find((s) => s.sourceShotId === "ap_shot_1")!;
  const randomShot = (rnd: () => number, maxEvents: number) => {
    const D = [4, 6, 8, 12][Math.floor(rnd() * 4)]!;
    const n = 1 + Math.floor(rnd() * maxEvents);
    const events: ManhuaActionEvent[] = [];
    let clock = Math.round(rnd() * 2 * 24) / 24;
    for (let i = 0; i < n && clock < D - 0.5; i += 1) {
      const start = clock;
      const w = Math.round((0.1 + rnd() * 1) * 24) / 24;
      const c = Math.round((0.05 + rnd() * 0.5) * 24) / 24;
      const r = Math.round((0.1 + rnd() * 1.5) * 24) / 24;
      const end = Math.min(D, start + w + c + r);
      clock = end + Math.round(rnd() * 1 * 24) / 24;
      const cs = Math.min(end, start + w);
      const ce = Math.min(end, cs + c);
      const [atk, tgt] = rnd() < 0.5 ? [MAN, WOMAN] : [WOMAN, MAN];
      events.push({
        eventId: `nl_e${i}`, kind: "attack", actorId: atk, targetActorId: tgt, outcome: "unplanned", slowMotionIntent: false,
        phases: [
          { kind: "windup", sourceStartSec: start, sourceEndSec: cs },
          { kind: "contact", sourceStartSec: cs, sourceEndSec: ce },
          { kind: "recover", sourceStartSec: ce, sourceEndSec: end },
        ].filter((p) => p.sourceEndSec > p.sourceStartSec) as ManhuaActionEvent["phases"],
      } as ManhuaActionEvent);
    }
    const shot = { ...base, sourceSpan: { startSec: 0, endSec: D }, timeMap: { sourceDurationSec: D, spans: [] }, events };
    const timing = manhuaPrevisTimingForExecutableShot(shot, cam(D));
    return { D: timing.durationSec, events, cues: timing.contactCues };
  };
  it("≤2 次交锋（草稿 ≤7 镜，不触发上限丢镜）在默认/快/慢/手持/长反应停留下，每个有 cue 的攻击事件都有自己的接触镜", () => {
    const tempos = [
      undefined,
      resolveManhuaCameraTempo({ intentZh: "燃", hasContact: true }),
      { ...resolveManhuaCameraTempo({ intentZh: "静", hasContact: false }), maxCuts: 8 },
      { style: "handheld" as const },
      { reactionHoldSec: 4, maxCuts: 8 },
    ];
    for (let round = 0; round < 12; round += 1) {
      const { D, events, cues } = randomShot(lcg(11000 + round), 2);
      for (const tempo of tempos) {
        const { cameras } = choreographManhuaCameras({ durationSec: D, events, cues, actorPositions: positions, tempo });
        assertCameraContract(cameras, D);
        for (const cue of cues) {
          const contact = cameras.find((c) => c.kind === "contact" && c.eventId === cue.eventId);
          expect(contact, `round ${round} tempo ${JSON.stringify(tempo)} event ${cue.eventId}`).toBeTruthy();
          expect(contact!.startSec).toBeLessThanOrEqual(cue.contactSec + 1e-9);
        }
      }
    }
  });
});

describe("过肩镜与景别多样性门禁（0916 审片规则）", () => {
  it("近身起手出过肩镜：机位贴攻方肩后、目标是受方、45mm；提示词写「过肩」；斗法起手仍是手部特写", () => {
    // 起手 ≥ 半秒才有起手镜：自建一次近身交锋（起手 0–2s，接触 2s，卸力到 3s）
    const events: ManhuaActionEvent[] = [{ eventId: "ots", kind: "attack", actorId: MAN, targetActorId: WOMAN, outcome: "unplanned", slowMotionIntent: false } as ManhuaActionEvent];
    const cues = [{ eventId: "ots", contactSec: 2, windupStartSec: 0, recoverEndSec: 3 }];
    const { cameras } = choreographManhuaCameras({ durationSec: 5, events, cues, actorPositions: positions });
    const ots = cameras.filter((c) => c.kind === "over_shoulder");
    expect(ots.length).toBeGreaterThan(0);
    for (const c of ots) {
      expect(c.lens).toBe(45);
      expect(c.position[2]).toBeGreaterThan(0.9);
      expect(c.position[2]).toBeLessThan(3);
      expect(manhuaCameraPromptZh(c)).toContain("过肩");
    }
    const ranged = choreographManhuaCameras({ durationSec: 5, events, cues, actorPositions: positions, eventManner: { ots: "ranged" } });
    expect(ranged.cameras.some((c) => c.kind === "over_shoulder")).toBe(false);
    expect(assessManhuaCameraVariety(cameras)).toEqual([]);
  });

  it("多样性门禁：同机位同景别 >3s、全平视、无过肩、无反应各自告警", () => {
    const flat = (startSec: number, endSec: number, kind: ManhuaChoreographedCamera["kind"] = "establish"): ManhuaChoreographedCamera => ({ kind, startSec, endSec, position: [0, -7, 1.5], target: [0, 0, 1], lens: 28, noteZh: "平视全景" });
    const issues = assessManhuaCameraVariety([flat(0, 4), flat(4, 7, "contact")]);
    expect(issues.map((i) => i.code)).toEqual(["same_setup_too_long", "flat_only", "no_over_shoulder", "no_reaction"]);
    expect(issues[0]!.messageZh).toContain("7.0 秒");
    expect(assessManhuaCameraVariety([flat(0, 2.5), { ...flat(2.5, 5), position: [0, -2, 0.5], lens: 45 }])).toEqual([]);
    expect(assessManhuaCameraVariety([])).toEqual([]);
  });
});
