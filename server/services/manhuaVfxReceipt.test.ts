import { expect, it } from "vitest";
import { findManhuaVfxReceipt, manhuaVfxTaskId, type VfxQueueDeps } from "./manhuaVfxTask";
import type { ManhuaVfxJob } from "../../shared/manhuaVfx";
const input: ManhuaVfxJob = { action: "manhua_vfx", scopeKey: "a", requestId: "12345678-1234-4234-8234-123456789abc", params: { videoUri: "gs://bucket/post-prod/7/source.mp4", sourceKey: "source", composition: { version: 1, seed: 1, effects: [{ id: "hit", kind: "impact_burst", startSec: 0, durationSec: 1, color: "#11CCFF", scale: .2, intensity: 1, anchor: { space: "screen", position: [.5,.5] } }] } } };
it("recovers a signed-source receipt without reauthorization or resubmission; refuses identity substitution", async () => {
  const deps: VfxQueueDeps = { load: async () => ({ id: manhuaVfxTaskId("7", input.requestId), userId: "7", type: "post_prod", status: "failed", input }), insert: async () => { throw new Error("must never insert"); } };
  const signed = { ...input, params: { ...input.params, videoUri: "https://storage.googleapis.com/bucket/post-prod/7/source.mp4?expired=1" } };
  expect(await findManhuaVfxReceipt("7", signed, deps)).toEqual({ jobId: manhuaVfxTaskId("7", input.requestId), status: "failed" });
  await expect(findManhuaVfxReceipt("7", { ...signed, scopeKey: "b" }, deps)).rejects.toThrow("同一请求编号");
  await expect(findManhuaVfxReceipt("8", signed, deps)).rejects.toThrow("同一请求编号");
  expect(await findManhuaVfxReceipt("7", signed, { ...deps, load: async () => null })).toBeNull();
});
