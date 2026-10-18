import { expect, it } from "vitest";
import { newDigitalHumanDraft } from "@shared/digitalHumanStudio";
import { digitalHumanProjectSegmentOutputs } from "./digitalHumanProjectMedia";
it("混音字幕与特效真实任务缓存可供整片选择，跨段/失败/音频不进入", () => {
  const d = newDigitalHumanDraft("7", "00000000-0000-4000-8000-000000000001");
  d.postProdStorage["postProd.jobs.v2.u7"] = JSON.stringify([
    {
      jobId: "mix",
      action: "bgm_mount",
      status: "succeeded",
      scopeKey: `digital-human:${d.id}`,
      createdAt: 1,
      output: { gcsUri: "gs://test-only/mixed.mp4" },
    },
    {
      jobId: "effect",
      action: "manhua_vfx",
      status: "succeeded",
      scopeKey: `digital-human:${d.id}`,
      createdAt: 2,
      output: { gcsUri: "gs://test-only/effect.mp4" },
    },
    {
      jobId: "other",
      action: "concat",
      status: "succeeded",
      scopeKey: "digital-human:another",
      createdAt: 3,
      output: { gcsUri: "gs://test-only/other.mp4" },
    },
    {
      jobId: "failed",
      action: "burn_subtitle",
      status: "failed",
      scopeKey: `digital-human:${d.id}`,
      createdAt: 4,
      output: { gcsUri: "gs://test-only/failed.mp4" },
    },
    {
      jobId: "audio",
      action: "audio_trim",
      status: "succeeded",
      scopeKey: `digital-human:${d.id}`,
      createdAt: 5,
      output: { gcsUri: "gs://test-only/audio.wav" },
    },
  ]);
  expect(digitalHumanProjectSegmentOutputs(d).map(c => c.source)).toEqual([
    "gs://test-only/mixed.mp4",
    "gs://test-only/effect.mp4",
  ]);
  expect(d.postProdStorage["postProd.jobs.v2.u7"]).toContain("other.mp4");
});
