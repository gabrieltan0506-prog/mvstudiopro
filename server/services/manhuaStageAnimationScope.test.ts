import { expect, it } from "vitest";
import { createManhuaPrevisStudio } from "../../shared/manhuaPrevis";
import { manhuaPrevisAnimationSource } from "../../shared/manhuaPrevisAnimationSource";
import { artMotionSpecSchema } from "../../shared/artMotion";
import { resolveManhuaStageAnimationSource } from "./manhuaStageAnimationSource";

it("独立顾问scope贯通动作来源，服务端仍拒绝scope及用户错配", async () => {
  const studio = createManhuaPrevisStudio(2);
  studio.spec.aspect = "9:16";
  studio.spec.exportAnimation = true;
  const sourceScopeId = crypto.randomUUID(), requestId = crypto.randomUUID();
  const jobId = `prv_${"c".repeat(48)}`, clipId = "clip-owned", worldTaskId = "world-owned";
  const request = { requestId, scopeId: sourceScopeId, clipId, spec: structuredClone(studio.spec) };
  studio.selectedJobId = jobId;
  studio.history = [{ jobId, requestId, sourceScopeId, spec: request.spec, durationSec: 2, createdAt: "2026-10-08T08:00:00Z", gcsUri: "gs://bucket/preview.mp4", url: `/api/manhua-previs-media/${jobId}/preview`, animation: { glbUrl: `/api/manhua-previs-media/${jobId}/animation`, framesUrl: `/api/manhua-previs-media/${jobId}/animation-frames`, sha256: "a".repeat(64), framesSha256: "b".repeat(64) } }];
  const source = manhuaPrevisAnimationSource(studio, clipId)!;
  const spec = artMotionSpecSchema.parse({ version: 1, mode: "animation", grammar: "y5_kinetic_type", duration: source.duration, width: 720, height: 1280, fps: 24, cues: [], data: {}, stageAnimation: { previsJobId: source.previsJobId, scopeId: source.scopeId, clipId: source.clipId, worldTaskId, sceneRef: "scene-owned", worldSourceVersion: "v-owned" } });
  const prefix = "gs://bucket/post-prod/7/previs/request/";
  const job = { id: jobId, userId: "7", type: "post_prod", provider: "blender-previs", status: "succeeded", input: { action: "manhua_previs", params: request }, output: { gcsUri: prefix + "preview.mp4", animation: { glbGcsUri: prefix + "animation.glb", framesGcsUri: prefix + "animation.frames.json", sha256: "a".repeat(64), framesSha256: "b".repeat(64) } } };
  const world = { taskId: worldTaskId, status: "succeeded", sceneRef: "scene-owned", sourceVersion: "v-owned", assets: { spz500kGcsUri: `gs://bucket/manhua-world/u7/${worldTaskId}/scene-500k.spz` } };
  const deps = { load: async () => job as never, world: async () => world as never, bucket: () => "bucket" };
  await expect(resolveManhuaStageAnimationSource("7", spec, requestId, deps)).resolves.toMatchObject({ input: request });
  await expect(resolveManhuaStageAnimationSource("7", { ...spec, stageAnimation: { ...spec.stageAnimation!, scopeId: studio.scopeId } }, requestId, deps)).rejects.toThrow("动作工程");
  await expect(resolveManhuaStageAnimationSource("8", spec, requestId, deps)).rejects.toThrow("动作工程");
});
