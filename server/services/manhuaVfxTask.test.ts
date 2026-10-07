import { describe, expect, it } from "vitest";
import { manhuaVfxTaskId, queueManhuaVfx, type VfxQueueDeps } from "./manhuaVfxTask";
import type { ManhuaVfxJob } from "../../shared/manhuaVfx";

const request: ManhuaVfxJob = {
  action: "manhua_vfx", requestId: "12345678-1234-4234-8234-123456789abc", scopeKey: "project-a-episode-1",
  params: { videoUri: "gs://test-bucket/post-prod/7/source.mp4", sourceKey: "source-v1", composition: { version: 1, seed: 3, effects: [
    { id: "hit", kind: "impact_burst", startSec: 0.5, durationSec: 1, color: "#11CCFF", scale: 0.2, intensity: 1, anchor: { space: "screen", position: [0.3, 0.6] } },
  ] } },
};
function memory() {
  const rows = new Map<string, { id: string; userId: string; type: string; status: string; input: unknown }>();
  let inserts = 0;
  const deps: VfxQueueDeps = { load: async id => rows.get(id) || null, insert: async (id, userId, input) => {
    if (!rows.has(id)) { inserts++; rows.set(id, { id, userId, type: "post_prod", status: "queued", input: structuredClone(input) }); }
  } };
  return { rows, deps, inserts: () => inserts };
}
describe("VFX durable submission identity", () => {
  it("concurrent replay creates one job; a completed/failed job is never reset", async () => {
    const db = memory();
    const [a, b] = await Promise.all([queueManhuaVfx("7", request, db.deps), queueManhuaVfx("7", request, db.deps)]);
    expect(a.jobId).toBe(b.jobId); expect(db.inserts()).toBe(1);
    db.rows.get(a.jobId)!.status = "failed";
    expect(await queueManhuaVfx("7", request, db.deps)).toEqual({ jobId: a.jobId, status: "failed" });
    expect(db.inserts()).toBe(1);
  });
  it("rejects same id reused for changed source, recipe or project without changing old payload", async () => {
    const db = memory(); await queueManhuaVfx("7", request, db.deps);
    const changes = [ { ...request, scopeKey: "project-b" }, { ...request, params: { ...request.params, sourceKey: "source-v2" } },
      { ...request, params: { ...request.params, composition: { ...request.params.composition, seed: 4 } } } ];
    for (const changed of changes) await expect(queueManhuaVfx("7", changed, db.deps)).rejects.toThrow("同一请求编号");
    expect(db.rows.get(manhuaVfxTaskId("7", request.requestId))!.input).toEqual(request);
    expect(manhuaVfxTaskId("8", request.requestId)).not.toBe(manhuaVfxTaskId("7", request.requestId));
  });
  it("does not report queued when insertion acknowledgement cannot be read", async () => {
    await expect(queueManhuaVfx("7", request, { load: async () => null, insert: async () => {} })).rejects.toThrow("回执尚未确认");
  });
});
