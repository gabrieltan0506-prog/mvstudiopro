import { describe, expect, it } from "vitest";
import { newDigitalHumanDraft, loadDigitalHumanDraft, digitalHumanSpatialFingerprint } from "@shared/digitalHumanStudio";
import { createManhuaPrevisStudio } from "@shared/manhuaPrevis";
import { digitalHumanSpatialCandidatePatch, makeDigitalHumanSpatialTarget, digitalHumanPrevisScenePatch, digitalHumanPrevisSceneAligned } from "./digitalHumanSpatialAdvisor";
import type { DigitalHumanSpatialCandidate } from "@shared/digitalHumanSpatialAdvisor";
function draft() {
  const d = newDigitalHumanDraft("7", "a51d8a78-1c90-4f1d-9c1e-324e7a3f4659");
  d.scene = { source: "gs://test-bucket/scene.png", name: "客厅" };
  d.portrait = { source: "gs://test-bucket/person.png", name: "本人" };
  d.worldTaskId = "world-test";
  d.mainModel = { taskId: "model-test", status: "succeeded", sourceVersion: d.portrait.source, sourceImageUrl: "https://example.test/person.png", glbUrl: "https://example.test/person.glb", updatedAt: 1 };
  d.stageAnchors = [{ id: "window", labelZh: "窗边", point: [3, 4], sceneSource: d.scene.source, worldTaskId: d.worldTaskId }];
  return d;
}
async function proposal(d = draft()): Promise<DigitalHumanSpatialCandidate> {
  const target = await makeDigitalHumanSpatialTarget(d);
  return { target, plan: { kind: "digital_human_spatial_v1", draftId: target.draftId, sourceRevision: target.sourceRevision,
    summaryZh: "站到窗边", unresolvedZh: [], actors: [{ actorId: target.actors[0].id, position: { kind: "relative", reference: "anchor", referenceId: "window", basis: "stage", rightM: 0, forwardM: 0 }, facing: { kind: "camera" } }], camera: { kind: "single", subjectActorId: target.actors[0].id } } };
}
describe("数字人场景方案到独立稿件", () => {
  it("不依赖先建立白模，采用改真实mainStage并可往返存储", async () => {
    const d = draft(), candidate = await proposal(d), before = JSON.stringify(d);
    const patch = await digitalHumanSpatialCandidatePatch(d, candidate);
    expect(JSON.stringify(d)).toBe(before);
    const next = { ...d, ...patch };
    expect(next.mainStage).toEqual({ x: 3, y: 4, yaw: 0 });
    expect(loadDigitalHumanDraft(JSON.stringify(next), "7")).toEqual(next);
    expect(digitalHumanSpatialFingerprint(next)).not.toBe(digitalHumanSpatialFingerprint(d));
  });
  it.each(["world", "actor", "anchor", "script", "model"])("迟到方案不能覆盖变化后的%s", async change => {
    const d = draft(), candidate = await proposal(d);
    if (change === "world") d.worldTaskId = "world-other";
    if (change === "actor") d.mainStage = { x: 1, y: 0, yaw: 0 };
    if (change === "anchor") d.stageAnchors![0].point = [8, 8];
    if (change === "script") d.script = "新口播";
    if (change === "model") d.mainModel!.glbUrl = "https://example.test/new-person.glb";
    await expect(digitalHumanSpatialCandidatePatch(d, candidate)).rejects.toThrow("变化");
  });
  it("缺失模型或旧图片绑定不发起场景咨询", async () => {
    const d = draft(); d.mainModel!.sourceVersion = "old";
    await expect(makeDigitalHumanSpatialTarget(d)).rejects.toThrow("模型");
  });
  it("未确认问题不允许采用", async () => {
    const d = draft(), candidate = await proposal(d); candidate.plan.unresolvedZh = ["请先确认站位地点"];
    await expect(digitalHumanSpatialCandidatePatch(d, candidate)).rejects.toThrow("请先确认");
  });
  it("有白模时采用场景使原动作失效而不删白模", async () => {
    const d = draft(); d.previsStudio = createManhuaPrevisStudio(10);
    const patch = await digitalHumanSpatialCandidatePatch(d, await proposal(d));
    expect(patch.previsSpatialInvalidated).toBe(true);
    expect("previsStudio" in patch).toBe(false); expect(d.previsStudio).toBeDefined();
  });
  it("动作顾问采用同步初始站位与首机位，禁止空人物映射", () => {
    const d = draft(), studio = createManhuaPrevisStudio(10);
    expect(() => digitalHumanPrevisScenePatch(d, studio)).toThrow("人物");
    studio.spec.actors[0] = { ...studio.spec.actors[0], id: `dh-person-${d.id}`, start: [2, 3], facingDeg: 45 };
    const patch = digitalHumanPrevisScenePatch(d, studio);
    expect(patch.mainStage).toEqual({ x: 2, y: 3, yaw: 45 });
    expect(patch.stageCamera?.position).toEqual(studio.spec.cameras[0].position);
    expect(patch.previsSpatialInvalidated).toBe(false);
  });
  it("旧稿无新增字段仍可读且不同世界的地点不混入", async () => {
    const d = draft(); d.stageAnchors![0].worldTaskId = "old-world";
    expect((await makeDigitalHumanSpatialTarget(d)).anchors).toEqual([]);
    delete d.stageAnchors;
    expect(loadDigitalHumanDraft(JSON.stringify(d), "7")).toEqual(d);
  });
});

it("历史白模缺少标记时仍拒绝人物或机位不一致，重新同步后恢复", () => {
  const d = draft(), studio = createManhuaPrevisStudio(10);
  studio.spec.actors[0] = { ...studio.spec.actors[0], id: `dh-person-${d.id}`, start: [2, 3], facingDeg: 45 };
  d.previsStudio = studio;
  expect(digitalHumanPrevisSceneAligned(d)).toBe(false);
  Object.assign(d, digitalHumanPrevisScenePatch(d, studio));
  expect(digitalHumanPrevisSceneAligned(d)).toBe(true);
  d.stageCamera = { ...d.stageCamera!, lens: d.stageCamera!.lens + 1 };
  expect(digitalHumanPrevisSceneAligned(d)).toBe(false);
  Object.assign(d, digitalHumanPrevisScenePatch(d, studio));
  d.previsSpatialInvalidated = true;
  expect(digitalHumanPrevisSceneAligned(d)).toBe(false);
});
