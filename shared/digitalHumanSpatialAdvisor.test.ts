import { describe, expect, it } from "vitest";
import { resolveDigitalHumanSpatialPlan } from "./digitalHumanSpatialAdvisor";
import { spatialTargetFixture, spatialPlanFixture } from "./digitalHumanSpatialAdvisor.fixtures";
describe("数字人真实场景站位合同", () => {
  it("确认地点产生真实站位，未修改人物完整保留，面向最终机位", () => {
    const result = resolveDigitalHumanSpatialPlan(spatialTargetFixture(), spatialPlanFixture());
    expect(result.actors[0]).toMatchObject({ point: [3, 4], yaw: 0 });
    expect(result.actors[1]).toEqual(spatialTargetFixture().actors[1]);
    expect(result.camera.target).toEqual([3, 4, 1.5]);
  });
  it("相对位置使用原稿，不随操作排序改变", () => {
    const plan = spatialPlanFixture();
    plan.actors.push({ actorId: "guest", position: { kind: "relative", reference: "actor", referenceId: "host", basis: "stage", rightM: 1, forwardM: 0 }, facing: { kind: "actor", actorId: "host" } });
    expect(resolveDigitalHumanSpatialPlan(spatialTargetFixture(), plan).actors[1].point).toEqual([1, 0]);
    plan.actors.reverse();
    expect(resolveDigitalHumanSpatialPlan(spatialTargetFixture(), plan).actors[1].point).toEqual([1, 0]);
  });
  it.each(["missing", "url"])('未知地点不可变成坐标（%s）', name => {
    const plan = spatialPlanFixture(); (plan.actors[0].position as any).referenceId = name;
    expect(() => resolveDigitalHumanSpatialPlan(spatialTargetFixture(), plan)).toThrow("地点尚未");
  });
  it("拒绝模型直接输出绝对坐标", () => {
    const plan = spatialPlanFixture(); (plan.actors[0].position as any) = { kind: "absolute", x: 5, y: 2 };
    expect(() => resolveDigitalHumanSpatialPlan(spatialTargetFixture(), plan)).toThrow();
  });
  it("拒绝过期、其他稿件与重复人物", () => {
    const plan = spatialPlanFixture();
    expect(() => resolveDigitalHumanSpatialPlan({ ...spatialTargetFixture(), sourceRevision: "b".repeat(64) }, plan)).toThrow("过期");
    expect(() => resolveDigitalHumanSpatialPlan({ ...spatialTargetFixture(), draftId: "a51d8a78-1c90-4f1d-9c1e-324e7a3f4660" }, plan)).toThrow("过期");
    plan.actors.push(plan.actors[0]); expect(() => resolveDigitalHumanSpatialPlan(spatialTargetFixture(), plan)).toThrow("重复");
  });
  it("过肩不能把同一人当两个人", () => {
    const plan = { ...spatialPlanFixture(), camera: { kind: "ots", subjectActorId: "host", overActorId: "host" } };
    expect(() => resolveDigitalHumanSpatialPlan(spatialTargetFixture(), plan)).toThrow("两名不同");
  });
  it("人物自身右侧与保存机位画面右侧不混淆", () => {
    const target = spatialTargetFixture(), plan = spatialPlanFixture();
    plan.actors = [{ actorId: "guest", position: { kind: "relative", reference: "actor", referenceId: "host", basis: "reference", rightM: 1, forwardM: 0 }, facing: { kind: "keep" } }];
    expect(resolveDigitalHumanSpatialPlan(target, plan).actors[1].point).toEqual([-1, 0]);
    (plan.actors[0].position as any).basis = "camera";
    expect(resolveDigitalHumanSpatialPlan(target, plan).actors[1].point).toEqual([1, 0]);
  });
  it("非有限数、超出范围和未提供人物关闭式失败", () => {
    const plan = spatialPlanFixture(); (plan.actors[0].position as any).rightM = Infinity;
    expect(() => resolveDigitalHumanSpatialPlan(spatialTargetFixture(), plan)).toThrow();
    plan.actors[0].position = { kind: "keep" }; plan.actors[0].actorId = "invented";
    expect(() => resolveDigitalHumanSpatialPlan(spatialTargetFixture(), plan)).toThrow("不存在");
  });
  it("未知地点可返回澄清，原位置不动", () => {
    const plan = { ...spatialPlanFixture(), unresolvedZh: ["请先在实际场景标记吧台旁"], actors: [], camera: { kind: "keep" } };
    expect(resolveDigitalHumanSpatialPlan(spatialTargetFixture(), plan).actors).toEqual(spatialTargetFixture().actors);
  });
});
