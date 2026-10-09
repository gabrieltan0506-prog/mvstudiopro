import { expect, it } from "vitest";
import { mergeManhuaVfxState, type ManhuaVfxState } from "./manhuaVfx";
const id = "12345678-1234-4234-8234-123456789abc";
const recipe = { version: 1 as const, seed: 1, effects: [{ id: "hit", kind: "impact_burst" as const, startSec: 0, durationSec: 1, color: "#11CCFF", scale: .2, intensity: 1, anchor: { space: "screen" as const, position: [.5,.5] as [number,number] } }] };
const before: ManhuaVfxState = { version: 1, scopeKey: "project-a", requests: { [id]: { sourceId: "source", videoUri: "gs://bucket/source.mp4", sourceKey: "source-v1", composition: recipe, requestId: id, createdAt: 1, jobId: "job-a", status: "succeeded", output: { gcsUri: "gs://bucket/result.mp4", sourceKey: "source-v1", composition: recipe, requestId: id } } } };
it("preserves all receipts across delayed saves and rejects changed immutable intentions", () => {
  expect(mergeManhuaVfxState(before, { version: 1, scopeKey: "project-a", requests: {} }).requests).toEqual(before.requests);
  const late = structuredClone(before); late.requests[id].status = "unknown"; delete late.requests[id].output;
  expect(mergeManhuaVfxState(before, late).requests[id]).toEqual(before.requests[id]);
  for (const field of ["sourceKey", "videoUri", "sourceId", "jobId"] as const) {
    const changed = structuredClone(before); changed.requests[id][field] = "changed";
    expect(() => mergeManhuaVfxState(before, changed)).toThrow();
  }
  expect(() => mergeManhuaVfxState(before, { ...before, scopeKey: "project-b" })).toThrow("当前作品");
});

it("分层包随候选恢复并保留迟到保存之前的回执，拒绝损坏的包身份", () => {
  const saved = structuredClone(before);
  const bundle = { gcsUri: "gs://bucket/post-prod/7/layers.zip", bytes: 2048, sha256: "a".repeat(64), kind: "same-scene-composite-v1" as const };
  saved.requests[id].output!.layerBundle = bundle;
  const restored = mergeManhuaVfxState(undefined, JSON.parse(JSON.stringify(saved)));
  expect(restored.requests[id].output!.layerBundle).toEqual(bundle);
  expect(mergeManhuaVfxState(restored, before).requests[id].output!.layerBundle).toEqual(bundle);
  expect(mergeManhuaVfxState(restored, { version: 1, scopeKey: "project-a", requests: {} }).requests[id].output!.layerBundle).toEqual(bundle);
  const broken = structuredClone(saved); broken.requests[id].output!.layerBundle!.sha256 = "invalid";
  expect(() => mergeManhuaVfxState(saved, broken)).toThrow();
  const replaced = structuredClone(saved); replaced.requests[id].output!.layerBundle!.sha256 = "b".repeat(64);
  expect(() => mergeManhuaVfxState(saved, replaced)).toThrow("不能改写");
});
