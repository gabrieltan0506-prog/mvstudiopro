import { describe, expect, it, vi } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisRequestSchema } from "../../shared/manhuaPrevis";
import { advisorPrevisSpecJson, makeAdvisorPrevisTarget, withAdvisorPrevisVideo } from "../../shared/manhuaAdvisorPrevisEdit";
import { resolveAdvisorPrevisVideo } from "./manhuaAdvisorPrevisVideo";
import { previsTaskId } from "./manhuaPrevisTask";
function fixture() {
 const studio = createManhuaPrevisStudio(5);
 const request = manhuaPrevisRequestSchema.parse({ requestId: crypto.randomUUID(), scopeId: studio.scopeId, clipId: "clip-1", spec: studio.spec });
 const target = { ...makeAdvisorPrevisTarget("clip-1", studio), previousPreviewRequestId: request.requestId };
 const job = { id: previsTaskId(7, request.requestId), userId: "7", type: "post_prod", provider: "blender-previs", status: "succeeded", input: { action: "manhua_previs", params: request }, output: { requestId: request.requestId, clipId: "clip-1", durationSec: 5, gcsUri: `gs://test/post-prod/7/previs/${request.requestId}/preview.mp4` } };
 const deps = { load: vi.fn().mockResolvedValue(job), read: vi.fn().mockResolvedValue(Buffer.from("0000ftypisom0000")) };
 return { studio, request, target, job, deps };
}
describe("顾问读取真实白模来源", () => {
 it("本人成功视频由服务端读字节，不接受客户端URL", async () => {
  const { target, request, job, deps } = fixture();
  expect(await resolveAdvisorPrevisVideo(7, target, deps)).toEqual({ requestId: request.requestId, durationSec: 5, url: "data:video/mp4;base64," + Buffer.from("0000ftypisom0000").toString("base64") });
  expect(deps.load).toHaveBeenCalledWith(job.id); expect(deps.read).toHaveBeenCalledWith(job.output.gcsUri);
 });
 it.each(["owner", "status", "clip", "spec", "duration", "receipt"])("拒绝%s错误且不读取", async kind => {
  const { target, job, deps } = fixture();
  if (kind === "owner") job.userId = "8";
  if (kind === "status") job.status = "running";
  if (kind === "clip") job.input.params.clipId = "other";
  if (kind === "spec") job.input.params.spec.cameras[0].lens = 60;
  if (kind === "duration") job.output.durationSec = 99;
  if (kind === "receipt") job.output.requestId = crypto.randomUUID();
  await expect(resolveAdvisorPrevisVideo(7, target, deps)).rejects.toThrow(); expect(deps.read).not.toHaveBeenCalled();
 });
 it("当前配置变动仍能读取选中旧片；跨片段不继承", async () => {
  const { studio, request, job, deps } = fixture();
  const oldSpec = structuredClone(studio.spec);
  studio.history.push({ ...job.output, jobId: job.id, url: "https://test.invalid/v.mp4", createdAt: "2026-09-29", spec: oldSpec });
  studio.spec.cameras[0].lens = 60;
  const target = makeAdvisorPrevisTarget("clip-1", studio, request.requestId);
  expect(target.previousPreviewSpecJson).toBe(advisorPrevisSpecJson(oldSpec));
  expect(await resolveAdvisorPrevisVideo(7, target, deps)).not.toBeNull();
  const source = { target, requestId: request.requestId, specJson: advisorPrevisSpecJson(oldSpec) };
  expect(withAdvisorPrevisVideo({ ...target, clipId: "other" }, source).previousPreviewRequestId).toBe(target.previousPreviewRequestId);
  expect(() => makeAdvisorPrevisTarget("clip-1", studio, crypto.randomUUID())).toThrow("尚未恢复");
 });
});
