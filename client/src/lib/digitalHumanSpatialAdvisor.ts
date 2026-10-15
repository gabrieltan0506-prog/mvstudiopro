import { digitalHumanSpatialFingerprint, type DigitalHumanDraft } from "@shared/digitalHumanStudio";
import { advisorWorldSourceRevision } from "@shared/manhuaAdvisorWorld";
import { digitalHumanSpatialTargetSchema, resolveDigitalHumanSpatialPlan, type DigitalHumanSpatialCandidate } from "@shared/digitalHumanSpatialAdvisor";
import { threeCameraRigForKeyframe } from "@shared/manhuaWorldStage";
import type { ManhuaPrevisStudio } from "@shared/manhuaPrevis";

export function digitalHumanSpatialActors(draft: DigitalHumanDraft) {
  return [
    ...(draft.portrait ? [{ id: `dh-person-${draft.id}`, labelZh: "讲述者", portrait: draft.portrait, model: draft.mainModel,
      x: draft.mainStage?.x ?? 0, y: draft.mainStage?.y ?? 0, yaw: draft.mainStage?.yaw ?? 0 }] : []),
    ...draft.actors,
  ];
}
export function digitalHumanCurrentAnchors(draft: DigitalHumanDraft) {
  return (draft.stageAnchors ?? []).filter(a => a.worldTaskId === draft.worldTaskId && a.sceneSource === draft.scene?.source);
}
export function digitalHumanSceneInputKey(draft: DigitalHumanDraft) {
  return JSON.stringify([draft.owner, draft.id, digitalHumanSpatialFingerprint(draft), digitalHumanCurrentAnchors(draft), digitalHumanSpatialActors(draft).map(a => [a.id, a.model?.glbUrl, a.model?.sourceVersion, a.model?.status])]);
}
export async function makeDigitalHumanSpatialTarget(draft: DigitalHumanDraft) {
  if (!draft.scene || !draft.worldTaskId) throw new Error("请先选择已生成的3D场景");
  const actors = digitalHumanSpatialActors(draft);
  if (!actors.length) throw new Error("请先添加场景人物");
  if (actors.some(a => a.model?.status !== "succeeded" || a.model.sourceVersion !== a.portrait.source || !a.model.glbUrl)) throw new Error("请先完成当前人物模型并核对绑定");
  const first = actors[0]!;
  return digitalHumanSpatialTargetSchema.parse({
    draftId: draft.id, worldTaskId: draft.worldTaskId,
    sourceRevision: await advisorWorldSourceRevision(digitalHumanSceneInputKey(draft)),
    sceneLabelZh: draft.sceneDescription || draft.scene.name,
    actors: actors.map(a => ({ id: a.id, labelZh: a.labelZh, point: [a.x, a.y], yaw: a.yaw })),
    anchors: digitalHumanCurrentAnchors(draft).map(({ id, labelZh, point }) => ({ id, labelZh, point })),
    camera: draft.stageCamera ?? threeCameraRigForKeyframe({ kind: "establish", subjectStage: [first.x, first.y, 0] }),
  });
}
export async function digitalHumanSpatialCandidatePatch(draft: DigitalHumanDraft, candidate: DigitalHumanSpatialCandidate) {
  const target = await makeDigitalHumanSpatialTarget(draft);
  if (JSON.stringify(target) !== JSON.stringify(candidate.target)) throw new Error("场景或人物已变化，旧方案不能试看或采用；原稿保留");
  if (candidate.plan.unresolvedZh.length) throw new Error(candidate.plan.unresolvedZh.join("；"));
  const result = resolveDigitalHumanSpatialPlan(target, candidate.plan);
  const main = result.actors.find(a => a.id === `dh-person-${draft.id}`);
  return {
    ...(main ? { mainStage: { x: main.point[0], y: main.point[1], yaw: main.yaw } } : {}),
    actors: draft.actors.map(a => {
      const row = result.actors.find(r => r.id === a.id)!;
      return { ...a, x: row.point[0], y: row.point[1], yaw: row.yaw };
    }),
    stageCamera: result.camera,
    previsSpatialInvalidated: Boolean(draft.previsStudio),
  } satisfies Partial<DigitalHumanDraft>;
}
/** 白模采用的起点与首机位同步回真实场景，不能只更新预演状态。 */
export function digitalHumanPrevisScenePatch(draft: DigitalHumanDraft, studio: ManhuaPrevisStudio): Partial<DigitalHumanDraft> {
  const actors = digitalHumanSpatialActors(draft);
  if (studio.spec.actors.length !== actors.length || actors.some(a => !studio.spec.actors.some(s => s.id === a.id))) throw new Error("白模人物与当前场景不一致，未采用");
  const first = studio.spec.cameras[0];
  const main = studio.spec.actors.find(a => a.id === `dh-person-${draft.id}`);
  return { previsStudio: studio, previsSpatialInvalidated: false,
    ...(main ? { mainStage: { x: main.start[0], y: main.start[1], yaw: main.facingDeg ?? 0 } } : {}),
    actors: draft.actors.map(a => { const s = studio.spec.actors.find(s => s.id === a.id)!; return { ...a, x: s.start[0], y: s.start[1], yaw: s.facingDeg ?? 0 }; }),
    ...(first ? { stageCamera: { kind: "establish", position: [...first.position], target: [...first.target], lens: first.lens, labelZh: "已采用白模首机位" } as const } : {}),
  };
}

/** 旧稿没有失效标记时也核对真实起点与首机位，不能继续播放另一套站位。 */
export function digitalHumanPrevisSceneAligned(draft: DigitalHumanDraft): boolean {
  const studio = draft.previsStudio;
  if (!studio) return true;
  if (draft.previsSpatialInvalidated) return false;
  const actors = digitalHumanSpatialActors(draft);
  if (studio.spec.actors.length !== actors.length) return false;
  if (actors.some(a => { const s = studio.spec.actors.find(s => s.id === a.id); return !s || s.start[0] !== a.x || s.start[1] !== a.y || (s.facingDeg ?? 0) !== a.yaw; })) return false;
  const camera = studio.spec.cameras[0];
  return !draft.stageCamera || Boolean(camera && JSON.stringify([camera.position, camera.target, camera.lens]) === JSON.stringify([draft.stageCamera.position, draft.stageCamera.target, draft.stageCamera.lens]));
}
