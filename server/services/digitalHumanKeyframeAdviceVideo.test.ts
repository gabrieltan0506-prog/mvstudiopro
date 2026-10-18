import { expect, it, vi } from "vitest";
import { keyframeAdviceDraftFixture } from "../../shared/digitalHumanKeyframeAdvice.fixtures";
import { makeDigitalHumanKeyframeAdviceTarget } from "../../client/src/lib/digitalHumanKeyframeAdvice";
import { resolveAdvisorPrevisVideo } from "./manhuaAdvisorPrevisVideo";
import { previsTaskId } from "./manhuaPrevisTask";
it("补图目标与既有视频解析器贯通，本人成功任务转为完整视频输入", async () => {
  const draft = keyframeAdviceDraftFixture(), target = makeDigitalHumanKeyframeAdviceTarget(draft), take = draft.previsStudio!.history[0];
  const job = { id: previsTaskId(7, take.requestId), userId: "7", type: "post_prod", provider: "blender-previs", status: "succeeded", input: { action: "manhua_previs", params: { requestId: take.requestId, scopeId: draft.previsStudio!.scopeId, clipId: target.previs.clipId, spec: take.spec } }, output: { requestId: take.requestId, clipId: target.previs.clipId, durationSec: 5, gcsUri: `gs://test-only/post-prod/7/previs/${take.requestId}/preview.mp4` } };
  const deps = { load: vi.fn().mockResolvedValue(job), read: vi.fn().mockResolvedValue(Buffer.from("0000ftypisom0000")) };
  const video = await resolveAdvisorPrevisVideo(7, target.previs, deps);
  expect(video?.requestId).toBe(take.requestId); expect(video?.url).toBe(`data:video/mp4;base64,${Buffer.from("0000ftypisom0000").toString("base64")}`);
  expect(deps.load).toHaveBeenCalledWith(job.id); expect(deps.read).toHaveBeenCalledWith(job.output.gcsUri);
});
