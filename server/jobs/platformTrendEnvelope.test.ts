import { expect, it } from "vitest";
import { asEnvelope } from "./runner";
it("趋势任务序列化恢复后保留外部证据，其他任务不继承", () => {
  const snapshot = { owner: 7, anchorMs: 1, platforms: ["douyin"], windowDays: 7, items: [{ id: "真实引用ID" }] };
  const saved = JSON.parse(JSON.stringify({ action: "platform_visual_report", params: { externalEvidenceRefs: [{ jobId: "j", itemIds: ["真实引用ID"] }] }, externalEvidenceSnapshot: snapshot }));
  expect(asEnvelope(saved).externalEvidenceSnapshot).toEqual(snapshot);
  expect(asEnvelope(saved).params).toEqual(saved.params);
  expect(asEnvelope({ ...saved, action: "other" }).externalEvidenceSnapshot).toBeUndefined();
});
