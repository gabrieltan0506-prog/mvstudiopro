import { expect, it } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema } from "../../shared/manhuaPrevis";
import { groundedRouteReportSchema, validateGroundedRouteReport } from "./manhuaPrevisGroundedRouteReport";

function fixture(horse = false, limp = false) {
  const spec = createManhuaPrevisStudio(2).spec, actor = spec.actors[0];
  actor.shape = horse ? "horse" : "human";
  actor.assetRef = "route-asset";
  actor.riggedModel = { sourceJobId: "m3d_saved", forwardAxis: "+X", targetHeight: 1.7, ...(horse ? { rigKind: "quadruped" as const } : {}) };
  actor.start = [-.15, 0]; actor.end = [.15, 0]; actor.facingDeg = 0;
  actor.actions = [{ kind: limp ? "limp_front_left" : horse ? "idle" : "walk", startSec: 0, endSec: limp ? 2 : 47 / 24 }];
  actor.motionRoute = [{ timeSec: 0, position: actor.start, facingDeg: 0 }, { timeSec: 47 / 24, position: actor.end, facingDeg: 0 }];
  const feet = horse ? ["frontLeft", "frontRight", "hindLeft", "hindRight"] as const : ["hindLeft", "hindRight"] as const;
  const report = groundedRouteReportSchema.parse({ actorId: actor.id, rigKind: horse ? "quadruped" : "human", frames: 48,
    footVertices: Object.fromEntries(feet.map(foot => [foot, 8])), meshMeasured: true, normalSpeedValidated: false, finalMeshVerified: true,
    samples: Array.from({ length: 48 }, (_, index) => ({ frame: index + 1, minimumHeight: 0,
      feet: feet.map(foot => ({ foot, stance: !(limp && foot === "frontLeft"), soleHeight: limp && foot === "frontLeft" ? .08 : 0, stanceSlip: 0, ankleResidual: 0 })) })),
  });
  return { spec, actor, report };
}
it.each([[false, false], [true, false], [true, true]])("真实带骨路线接入schema及足底证据：四足=%s，伤腿=%s", (horse, limp) => {
  const { spec, actor, report } = fixture(horse, limp);
  expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(true);
  expect(() => validateGroundedRouteReport(report, actor, 2)).not.toThrow();
  expect(() => validateGroundedRouteReport(undefined, actor, 2)).toThrow("足底");
});
it.each(["identity", "rig", "count", "order", "duplicateFoot", "missingVertex", "floating", "slipping", "residual", "floor", "unsupported"])("拒绝损坏的实际落脚证据：%s", mode => {
  const { actor, report } = fixture();
  if (mode === "identity") report.actorId = "other";
  if (mode === "rig") report.rigKind = "quadruped";
  if (mode === "count") report.samples.pop();
  if (mode === "order") report.samples[1].frame = 1;
  if (mode === "duplicateFoot") report.samples[0].feet[1].foot = "hindLeft";
  if (mode === "missingVertex") delete report.footVertices.hindLeft;
  if (mode === "floating") report.samples[0].feet[0].soleHeight = .04;
  if (mode === "slipping") report.samples[0].feet[0].stanceSlip = .016;
  if (mode === "residual") report.samples[0].feet[0].ankleResidual = .006;
  if (mode === "floor") report.samples[0].minimumHeight = -.006;
  if (mode === "unsupported") report.samples[0].feet.forEach(foot => { foot.stance = false; });
  expect(() => validateGroundedRouteReport(report, actor, 2)).toThrow();
});
it.each(["stance", "low"])("伤腿逐帧保持卸载：%s", mode => {
  const { actor, report } = fixture(true, true), injured = report.samples[20].feet[0];
  if (mode === "stance") { injured.stance = true; injured.soleHeight = 0; } else injured.soleHeight = .02;
  expect(() => validateGroundedRouteReport(report, actor, 2)).toThrow("伤腿");
});
it("旧无路线不要求新回执，拒绝伪装正常速度审片和不兼容表演", () => {
  const { spec, actor, report } = fixture();
  actor.actions = [{ kind: "gesture_point", startSec: 0, endSec: 1 }];
  expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
  expect(groundedRouteReportSchema.safeParse({ ...report, normalSpeedValidated: true }).success).toBe(false);
  delete actor.motionRoute;
  expect(() => validateGroundedRouteReport(undefined, actor, 2)).not.toThrow();
  expect(() => validateGroundedRouteReport(report, actor, 2)).toThrow("无真实模型路线");
});
