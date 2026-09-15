import { describe, expect, it } from "vitest";
import { buildBoatFight, A, B, MAN, WOMAN } from "./manhuaActionPlanBoatFightFixture";
import { splitManhuaActionPlanForPrevis } from "./manhuaActionPlanSplit";
import { manhuaPrevisTimingForExecutableShot } from "./manhuaPrevisTiming";
import { manhuaPrevisSpecSchema } from "./manhuaPrevis";
import { manhuaPrevisDraftFromExecutableShot } from "./manhuaPrevisFromActionPlan";
import { CONTACT_LEAD_FRAMES, MANHUA_CAMERA_MAX_CUTS, choreographManhuaCameras } from "./manhuaCameraGrammar";

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
    // 施法起手要有 ≥ 半秒才有起手镜：把 1b 的起手提前到 1.2s（夹具里起手只有 0.46s）
    const cues = timing.contactCues.map((c) => (c.eventId === "ap_evt_1b" ? { ...c, windupStartSec: 1.2 } : c));
    const { cameras } = choreographManhuaCameras({ durationSec: timing.durationSec, events: shot.events, cues, actorPositions: positions, eventManner: { ap_evt_1b: "ranged" } });
    const spell = cameras.find((c) => c.kind === "contact" && c.eventId === "ap_evt_1b")!;
    expect(spell.lens).toBe(32);
    expect(spell.position[2]).toBeLessThan(0.9);
    // 命中镜机位靠受方（MAN 在 -1.25）而不是攻方（WOMAN 在 1.25）
    expect(spell.position[0]).toBeLessThan(0);
    const melee = cameras.find((c) => c.kind === "contact" && c.eventId === "ap_evt_1a")!;
    expect(melee.lens).toBe(45);
    expect(cameras.some((c) => c.kind === "windup" && c.eventId === "ap_evt_1b" && c.lens === 55)).toBe(true);
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
