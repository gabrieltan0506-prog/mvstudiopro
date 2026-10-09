import { describe, expect, it } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisStudioSchema } from "./manhuaPrevis";
import { manhuaPrevisAnimationSource } from "./manhuaPrevisAnimationSource";
import { sanitizeManhuaCloudDraftBlock } from "./manhuaCloudDraft";

function savedStudio(sourceScopeId?: string) {
  const studio = createManhuaPrevisStudio(5);
  studio.spec.exportAnimation = true;
  const jobId = `prv_${"a".repeat(48)}`;
  studio.selectedJobId = jobId;
  studio.history = [{ jobId, requestId: crypto.randomUUID(), sourceScopeId,
    gcsUri: "gs://test/preview.mp4", url: "/api/manhua-previs-media/test/preview", durationSec: 5,
    createdAt: "2026-10-08T08:00:00Z", spec: structuredClone(studio.spec),
    animation: { glbUrl: `/api/manhua-previs-media/${jobId}/animation`, framesUrl: `/api/manhua-previs-media/${jobId}/animation-frames`, sha256: "a".repeat(64), framesSha256: "b".repeat(64) },
  }];
  return studio;
}

describe("动画来源scope随已确认回执持久化", () => {
  it("独立顾问scope经过云草稿恢复后作为动画来源，保留工作台scope", () => {
    const sourceScopeId = crypto.randomUUID();
    const studio = savedStudio(sourceScopeId);
    const restored = sanitizeManhuaCloudDraftBlock({ id: "clip-1", kind: "video", previsStudio: studio } as never)!.previsStudio!;
    expect(manhuaPrevisStudioSchema.parse(restored).history[0].sourceScopeId).toBe(sourceScopeId);
    expect(restored.scopeId).toBe(studio.scopeId);
    expect(manhuaPrevisAnimationSource(restored, "clip-1")).toEqual({ previsJobId: studio.selectedJobId, scopeId: sourceScopeId, clipId: "clip-1", duration: 5, aspect: studio.spec.aspect });
  });
  it("旧记录没有来源scope时回退工作台scope", () => {
    const studio = savedStudio();
    expect(manhuaPrevisAnimationSource(studio, "clip-1")?.scopeId).toBe(studio.scopeId);
  });
  it("当前配置已变化时不给来源，避免旧动画套用新动作", () => {
    const studio = savedStudio(crypto.randomUUID());
    studio.spec.cameras[0].lens = 85;
    expect(manhuaPrevisAnimationSource(studio, "clip-1")).toBeUndefined();
  });
  it("动画端点串任务、未选择与缺少片段均不给来源", () => {
    const studio = savedStudio();
    studio.history[0].animation!.glbUrl = `/api/manhua-previs-media/prv_${"b".repeat(48)}/animation`;
    expect(manhuaPrevisAnimationSource(studio, "clip-1")).toBeUndefined();
    studio.selectedJobId = undefined;
    expect(manhuaPrevisAnimationSource(studio, "clip-1")).toBeUndefined();
    expect(manhuaPrevisAnimationSource(studio, undefined)).toBeUndefined();
  });
});
