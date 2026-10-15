import { digitalHumanSpatialTargetSchema, type DigitalHumanSpatialPlan } from "./digitalHumanSpatialAdvisor";
export const spatialTargetFixture = () => digitalHumanSpatialTargetSchema.parse({
  draftId: "a51d8a78-1c90-4f1d-9c1e-324e7a3f4659", worldTaskId: "world-test", sourceRevision: "a".repeat(64), sceneLabelZh: "已确认咖啡厅",
  actors: [{ id: "host", labelZh: "讲述者", point: [0, 0], yaw: 0 }, { id: "guest", labelZh: "来宾", point: [2, 1], yaw: 90 }],
  anchors: [{ id: "window", labelZh: "窗边", point: [3, 4] }],
  camera: { kind: "establish", position: [0, -7, 3], target: [0, 0, 1], lens: 28, labelZh: "全景" },
});
export const spatialPlanFixture = (): DigitalHumanSpatialPlan => ({ kind: "digital_human_spatial_v1", draftId: spatialTargetFixture().draftId, sourceRevision: "a".repeat(64), summaryZh: "讲述者到窗边，面向镜头", unresolvedZh: [],
  actors: [{ actorId: "host", position: { kind: "relative", reference: "anchor", referenceId: "window", basis: "stage", rightM: 0, forwardM: 0 }, facing: { kind: "camera" } }], camera: { kind: "single", subjectActorId: "host" } });
