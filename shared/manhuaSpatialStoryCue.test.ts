import { describe, expect, it } from "vitest";
import { compileManhuaSceneSpace, inspectManhuaSceneSpace, normalizeManhuaSpatialContext, normalizeManhuaSceneSpace, type ManhuaSceneSpace, type ManhuaSpatialContext } from "./manhuaSceneSpace";
import { projectManhuaSpatialStoryCuesForBgm } from "./manhuaSpatialStoryCue";
import { buildManhuaWriterSession, parseManhuaWriterSession, serializeManhuaWriterSession } from "./manhuaWriterSession";
import { normalizeManhuaCustomAssetRefs } from "./manhuaCustomAssetRefs";
const scope = { episode: 1, segmentIndex: 2, shotId: "5", sourceRevision: "source-v1" };
const space: ManhuaSceneSpace = {
 version: 1, sourceRefId: "farm", sourceVersion: "gs://test/farm.png", revision: 9, status: "approved", sourceNoteZh: "第二段农舍原稿",
 zones: [{ id: "yard", labelZh: "雪坡", fixedFeaturesZh: "北侧农舍" }, { id: "door", labelZh: "后门", fixedFeaturesZh: "门后楼梯" }],
 passages: [{ id: "path", fromId: "yard", toId: "door", labelZh: "雪路", bidirectional: false, directionZh: "向北", designDistanceM: 55, slopeZh: "向北上坡", designBasisZh: "作者路线草图，设计示意" }],
 actorPositions: [{ id: "pos-1", scope, actorId: "daughter", zoneId: "door", positionZh: "门外左侧", designPosition: { x: 0.2, y: 0.7, facingDegrees: 90 }, facingZh: "朝向门内", visibility: "occluded", occlusionZh: "门扇遮住身体，仍在门外", sourceZh: "第五镜" }],
 storyCues: [{ id: "event-1", scope, passageId: "path", actorId: "daughter", eventZh: "女儿走到后门听见父母争吵，停步", emotionZh: "安心转为警惕", musicCue: "breath", musicNoteZh: "停音乐，保留风声与门内对白", sourceZh: "第五镜原稿" }],
};
const ref = { id: "farm", role: "scene" as const, url: "https://test.example/farm.png", gcsUri: space.sourceVersion, sceneSpace: space };
const context: ManhuaSpatialContext = { ...scope, shotIds: ["5"], actorIds: ["daughter"], sceneIds: ["farm"] };
describe("空间路线、同角色站位和剧情音乐真实合同", () => {
 it("保存恢复不改变身份/版本，最终编译和音乐都消费同一条路线事件", () => {
  const restored = parseManhuaWriterSession(serializeManhuaWriterSession(buildManhuaWriterSession({ customAssetRefs: normalizeManhuaCustomAssetRefs([ref]) })))!;
  expect(restored.customAssetRefs[0].sceneSpace).toEqual(space);
  const prompt = compileManhuaSceneSpace(restored.customAssetRefs, [ref.id], context);
  expect(prompt).toContain("设计距离55米（非实测）");
  expect(prompt).toContain("daughter在后门·门外左侧，朝向朝向门内");
  expect(prompt).toContain("示意坐标x=0.2,y=0.7；图上朝向90度");
  expect(prompt).toContain(space.storyCues![0].eventZh);
  const bgm = projectManhuaSpatialStoryCuesForBgm(restored.customAssetRefs, [context]);
  expect(bgm.hasSilenceBreak).toBe(true);
  expect(bgm.breathSegmentIndexes).toEqual([2]);
  expect(bgm.cues.map(c => [c.id, c.revision, c.sceneId])).toEqual([["event-1", 9, "farm"]]);
  expect(bgm.noteZh).toContain("[场景farm·v9·事件event-1]");
  expect(bgm.noteZh).toContain("停音乐，保留风声与门内对白");
 });
 it("异集、异段、异镜、删除人物、换来源、未确认不可借用事件", () => {
  for (const changed of [{ ...context, sourceRevision: "source-v2" }, { ...context, episode: 2 }, { ...context, segmentIndex: 3 }, { ...context, shotIds: ["6"] }, { ...context, actorIds: [] }]) {
   expect(compileManhuaSceneSpace([ref], [ref.id], changed)).not.toContain("人物调度：");
   expect(projectManhuaSpatialStoryCuesForBgm([ref], [changed]).cues).toHaveLength(0);
  }
  expect(projectManhuaSpatialStoryCuesForBgm([ref], [{ ...context, sceneIds: ["other"] }]).cues).toHaveLength(0);
  for (const changed of [{ ...ref, gcsUri: "gs://test/new.png" }, { ...ref, sceneSpace: { ...space, status: "draft" as const } }]) {
   expect(projectManhuaSpatialStoryCuesForBgm([changed], [context]).cues).toHaveLength(0);
  }
 });
 it("路线设计数值不映射音量或情绪；变更坡向距离不改变音乐投影", () => {
  const changed = { ...ref, sceneSpace: { ...space, passages: [{ ...space.passages[0], designDistanceM: 500, slopeZh: "下坡" }] } };
  expect(projectManhuaSpatialStoryCuesForBgm([changed], [context])).toEqual(projectManhuaSpatialStoryCuesForBgm([ref], [context]));
 });
 it("拒绝悬空关联、无依据路线、无去向画外；非法context不恢复", () => {
  expect(inspectManhuaSceneSpace(space)).toEqual([]);
  expect(inspectManhuaSceneSpace({ ...space, passages: [{ ...space.passages[0], designBasisZh: "" }] })).toContain("路线方向、设计距离与坡向须填写设计依据");
  expect(inspectManhuaSceneSpace({ ...space, actorPositions: [{ ...space.actorPositions![0], occlusionZh: "" }] })).not.toHaveLength(0);
  expect(inspectManhuaSceneSpace({ ...space, storyCues: [{ ...space.storyCues![0], passageId: "missing" }] })).not.toHaveLength(0);
  expect(normalizeManhuaSceneSpace({ ...space, actorPositions: [{ ...space.actorPositions![0], designPosition: { x: 2, y: 0.5, facingDegrees: 0 } }] })).toBeUndefined();
  expect(normalizeManhuaSpatialContext({ ...context, episode: 0 })).toBeUndefined();
  expect(normalizeManhuaSpatialContext(context)).toEqual({ episode: 1, segmentIndex: 2, shotIds: ["5"], actorIds: ["daughter"], sceneIds: ["farm"], sourceRevision: "source-v1" });
 });
});
