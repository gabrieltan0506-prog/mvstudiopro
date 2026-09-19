import { describe, expect, it } from "vitest";
import { compileManhuaSceneSpace, inspectManhuaSceneSpace, manhuaSceneSpaceState, type ManhuaSceneSpace } from "./manhuaSceneSpace";
import { normalizeManhuaCustomAssetRefs } from "./manhuaCustomAssetRefs";
import { buildManhuaWriterSession, parseManhuaWriterSession, serializeManhuaWriterSession } from "./manhuaWriterSession";
const space: ManhuaSceneSpace = { version: 1, sourceRefId: "scene-clinic", sourceVersion: "gs://scene/clinic.png", revision: 2, status: "approved", sourceNoteZh: "墨菁传医馆第4镜门槛段", zones: [{ id: "yard", labelZh: "医馆后院", fixedFeaturesZh: "井台在东侧" }, { id: "room", labelZh: "诊室", fixedFeaturesZh: "北墙药柜" }], passages: [{ id: "door", fromId: "yard", toId: "room", labelZh: "木门门槛", bidirectional: true }] };
const ref = { id: "scene-clinic", role: "scene" as const, url: "https://cdn.test/clinic.png", gcsUri: space.sourceVersion, sceneSpace: space };
describe("场景空间实际保存消费", () => {
 it("场景ref经过真实writerSession序列化仍保留身份、来源、确认版本", () => {
  const refs = normalizeManhuaCustomAssetRefs([ref]);
  const session = buildManhuaWriterSession({ customAssetRefs: refs });
  const restored = parseManhuaWriterSession(serializeManhuaWriterSession(session));
  expect(restored?.customAssetRefs[0].sceneSpace).toEqual(space);
  expect(compileManhuaSceneSpace(restored!.customAssetRefs, [ref.id])).toContain("医馆后院↔诊室（木门门槛）");
 });
 it("草稿、换来源、未审图、其它场景一律不消费，源数据仍保存", () => {
  for (const changed of [{ ...ref, sceneSpace: { ...space, status: "draft" as const } }, { ...ref, gcsUri: "gs://scene/clinic-v2.png" }, { ...ref, reviewStatus: "needs_review" }]) expect(compileManhuaSceneSpace([changed], [ref.id])).toBe("");
  expect(manhuaSceneSpaceState({ ...ref, gcsUri: "gs://scene/clinic-v2.png" })).toBe("stale");
  expect(compileManhuaSceneSpace([ref], ["other-scene"])).toBe("");
 });
 it("不接受悬空通路、空来源、空区域名；不编造几何", () => {
  expect(inspectManhuaSceneSpace({ ...space, sourceNoteZh: "", passages: [{ ...space.passages[0], toId: "missing" }] })).toHaveLength(2);
  expect(compileManhuaSceneSpace([ref], [ref.id])).toContain("非比例拓扑，不代表实测几何");
 });
});
