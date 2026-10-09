import { expect, it } from "vitest";
import { createManhuaPrevisStudio } from "./manhuaPrevis";
import { deriveManhuaVfxChoreographySpec, manhuaVfxChoreographySchema, manhuaVfxSceneActorBindings, type ManhuaVfxChoreography } from "./manhuaVfxChoreography";

function fixture() {
  const spec = createManhuaPrevisStudio(4).spec;
  spec.actors[0] = { ...spec.actors[0], id: "motu", nameZh: "墨屠", shape: "horse" };
  spec.actors.push({ ...spec.actors[0], id: "qing", nameZh: "墨菁", shape: "human", start: [3, 0], end: [3, 0] });
  const plan: ManhuaVfxChoreography = { clearanceMeters: .08, routes: [{ actorId: "motu", points: [
    { timeSec: 0, position: [-1, 0], facingDeg: 0 }, { timeSec: 2, position: [0, 1], facingDeg: 45 }, { timeSec: 95 / 24, position: [1, 1], facingDeg: 0 },
  ] }] };
  return { spec, plan };
}
it("路线按角色身份派生，保留四足类型及其他角色，不修改原spec", () => {
  const { spec, plan } = fixture(), original = structuredClone(spec);
  const derived = deriveManhuaVfxChoreographySpec(spec, plan);
  expect(spec).toEqual(original);
  expect(derived.actors[0]).toMatchObject({ id: "motu", shape: "horse", motionRoute: plan.routes[0].points, start: [-1, 0], end: [1, 1] });
  expect(derived.actors[1]).toEqual(spec.actors[1]);
  expect(manhuaVfxSceneActorBindings(derived)[0]).toMatchObject({ actorId: "motu", rigKind: "quadruped", binding: "source" });
});
it("人形路线接真实walk生产者，静止路线和未知角色不能冒充穿行", () => {
  const { spec, plan } = fixture(); plan.routes[0].actorId = "qing";
  expect(deriveManhuaVfxChoreographySpec(spec, plan).actors[1].actions).toEqual([{ kind: "walk", startSec: 0, endSec: 95 / 24 }]);
  plan.routes[0].actorId = "other";
  expect(() => deriveManhuaVfxChoreographySpec(spec, plan)).toThrow("不属于");
  plan.routes[0].points.forEach(point => { point.position = [0, 0]; });
  expect(manhuaVfxChoreographySchema.safeParse(plan).success).toBe(false);
});
it("拒绝重复身份、非帧对齐、倒序和越界路线", () => {
  const { spec, plan } = fixture();
  expect(manhuaVfxChoreographySchema.safeParse({ ...plan, routes: [...plan.routes, plan.routes[0]] }).success).toBe(false);
  for (const time of [.01, 0, -1, 31]) {
    const bad = structuredClone(plan); bad.routes[0].points[1].timeSec = time;
    expect(manhuaVfxChoreographySchema.safeParse(bad).success).toBe(false);
  }
  const long = structuredClone(plan); long.routes[0].points[2].timeSec = 5;
  expect(() => deriveManhuaVfxChoreographySpec(spec, long)).toThrow("超出");
});
it("保留已设计的接触与独立表演，路线不能悄悄覆盖它们", () => {
  const { spec, plan } = fixture(); plan.routes[0].actorId = "qing";
  spec.actors[1].actions = [{ kind: "gesture_point", startSec: 1, endSec: 2 }];
  expect(() => deriveManhuaVfxChoreographySpec(spec, plan)).toThrow("独立表演");
  spec.actors[1].actions = [];
  spec.actors[0].shape = "human";
  spec.interactions = [{ id: "touch", kind: "support_walk", actorId: "qing", targetActorId: "motu", startSec: 0, contactSec: 1, endSec: 3 }];
  expect(() => deriveManhuaVfxChoreographySpec(spec, plan)).toThrow();
});
