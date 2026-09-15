import { describe, expect, it } from "vitest";
import { buildBoatFight } from "./manhuaActionPlanBoatFightFixture";
import { splitManhuaActionPlanForPrevis } from "./manhuaActionPlanSplit";
import { manhuaPrevisTimingForExecutableShot } from "./manhuaPrevisTiming";

const cam = (endSec: number, over: Record<string, unknown> = {}) => ({
  source: "previs_cameras" as const,
  sourceShotRef: "pv",
  sourceRevision: "r",
  coverage: { startSec: 0, endSec },
  coverageBasis: "source" as const,
  sampling: { kind: "discrete" as const, fps: 24 },
  timedSamplesAvailable: true,
  ...over,
});

describe("previs 时序桥：同一 timeMap，不复制第四份镜头时间", () => {
  const { shots } = splitManhuaActionPlanForPrevis(buildBoatFight());
  const water = shots.find((s) => s.kind === "water_emerge")!;
  const fight = shots.find((s) => s.sourceShotId === "ap_shot_3")!;

  it("源区间 → 整数秒 + 24fps 帧数；不足整秒向上取整并登记 padSec", () => {
    const t = manhuaPrevisTimingForExecutableShot(water, cam(6));
    expect(t.sourceSpan).toEqual(water.sourceSpan);
    expect(t.durationSec).toBe(Math.ceil(water.sourceSpan.endSec - water.sourceSpan.startSec));
    expect(t.frameEnd).toBe(t.durationSec * 24);
    expect(t.padSec).toBeCloseTo(t.durationSec - (water.sourceSpan.endSec - water.sourceSpan.startSec), 6);
    expect(t.issues.map((i) => i.code)).toEqual([]);
  });

  it("接触点相对本区间起点；attack 带 targetActorId；慢看意图原样带出", () => {
    const t = manhuaPrevisTimingForExecutableShot(fight, cam(8));
    const attacks = t.contactCues.filter((c) => c.kind === "attack");
    expect(attacks.map((c) => `${c.actorId}>${c.targetActorId}`)).toEqual(["ap_actor_man>ap_actor_ambush_a", "ap_actor_woman>ap_actor_ambush_b"]);
    // phases(1,4)：contact 段起点 = 1 + 1 = 2
    expect(attacks[0]!.contactSec).toBeCloseTo(2, 6);
    expect(attacks[0]!.windupStartSec).toBeCloseTo(1, 6);
    expect(attacks[0]!.recoverEndSec).toBeCloseTo(4, 6);
    const emerge = manhuaPrevisTimingForExecutableShot(water, cam(6)).contactCues.filter((c) => c.kind === "emerge");
    expect(emerge.every((c) => c.slowMotionIntent)).toBe(true);
  });

  it("相机：无时间采样 → camera_timing_unavailable；覆盖不全 → camera_coverage_incomplete；呈现基准 → 不换算如实报", () => {
    expect(manhuaPrevisTimingForExecutableShot(fight, null).issues.map((i) => i.code)).toContain("camera_timing_unavailable");
    expect(manhuaPrevisTimingForExecutableShot(fight, cam(8, { timedSamplesAvailable: false })).issues.map((i) => i.code)).toContain("camera_timing_unavailable");
    const partial = manhuaPrevisTimingForExecutableShot(fight, cam(5));
    expect(partial.issues.map((i) => i.code)).toContain("camera_coverage_incomplete");
    expect(partial.cameraCoverage).toEqual({ startSec: 0, endSec: 5 });
    expect(manhuaPrevisTimingForExecutableShot(fight, cam(8, { coverageBasis: "presentation" })).issues.map((i) => i.code)).toContain("camera_coverage_incomplete");
  });

  it("变速段裁到本区间并给出呈现起止：慢看 2–3s ×0.5 → 呈现 2–4s，总呈现 9s", () => {
    const slowShot = { ...fight, timeMap: { sourceDurationSec: 8, spans: [
      { sourceStartSec: 0, sourceEndSec: 2, rate: 1 },
      { sourceStartSec: 2, sourceEndSec: 3, rate: 0.5 },
      { sourceStartSec: 3, sourceEndSec: 8, rate: 1 },
    ] } };
    const t = manhuaPrevisTimingForExecutableShot(slowShot, cam(8));
    expect(t.presentationSpans).toEqual([
      { sourceStartSec: 0, sourceEndSec: 2, rate: 1, presentationStartSec: 0, presentationEndSec: 2 },
      { sourceStartSec: 2, sourceEndSec: 3, rate: 0.5, presentationStartSec: 2, presentationEndSec: 4 },
      { sourceStartSec: 3, sourceEndSec: 8, rate: 1, presentationStartSec: 4, presentationEndSec: 9 },
    ]);
    // 白模本身仍按源时间常速：durationSec 不因慢看变长
    expect(t.durationSec).toBe(8);
  });

  it("超过白模 30s 上限 → span_exceeds_previs_max，不静默截断", () => {
    const long = { ...fight, sourceSpan: { startSec: 0, endSec: 31 }, timeMap: { sourceDurationSec: 31, spans: [] } };
    const t = manhuaPrevisTimingForExecutableShot(long, cam(31));
    expect(t.issues.map((i) => i.code)).toContain("span_exceeds_previs_max");
    expect(t.durationSec).toBe(30);
  });
});
