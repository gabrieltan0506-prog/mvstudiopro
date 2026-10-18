import { expect, it } from "vitest";
import { newDigitalHumanDraft } from "@shared/digitalHumanStudio";
import { digitalHumanProjectSegmentOutputs } from "./digitalHumanProjectMedia";
it("混音字幕任务可供整片选择，未采用特效与跨段失败音频不进入", () => {
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
  ]);
  expect(d.postProdStorage["postProd.jobs.v2.u7"]).toContain("other.mp4");
});

import { digitalHumanPostProdMedia, digitalHumanVfxKey } from "./digitalHumanPostProd";
import { makeManhuaVfxEffect, manhuaVfxSourceKey } from "./manhuaVfxWorkflow";
it("特效显式采用才进入整片，换源后失效；主片历史超分仍可选择", () => {
  const d = newDigitalHumanDraft("7", "00000000-0000-4000-8000-000000000001");
  const requestId = "00000000-0000-4000-8000-000000000099";
  d.videos = [{ requestId, status: "succeeded", source: "gs://test-only/raw.mp4", upscaleHistory: [{ taskId: "old-hd", status: "succeeded", source: "gs://test-only/old-hd.mp4" }] } as any];
  const clip = digitalHumanPostProdMedia(d).clips[0];
  const scope = `digital-human:${d.id}`;
  const composition = { version: 1, seed: 1, effects: [makeManhuaVfxEffect("shield", "shield-1")] };
  const source = { sourceId: clip.id, videoUri: clip.url, sourceKey: manhuaVfxSourceKey(clip), composition };
  const state = { version: 1, scopeKey: scope, draft: source, requests: { [requestId]: { ...source, requestId, jobId: "vfx", status: "succeeded", createdAt: 1, output: { gcsUri: "gs://test-only/adopted.mp4", requestId, sourceKey: source.sourceKey, composition } } } };
  const key = digitalHumanVfxKey(scope);
  d.postProdStorage[key] = JSON.stringify(state);
  expect(digitalHumanProjectSegmentOutputs(d).some(c => c.source.endsWith("adopted.mp4"))).toBe(false);
  d.postProdStorage[key] = JSON.stringify({ ...state, adoptedRequestId: requestId });
  expect(digitalHumanProjectSegmentOutputs(d).map(c => c.source)).toEqual(["gs://test-only/adopted.mp4", "gs://test-only/raw.mp4", "gs://test-only/old-hd.mp4"]);
  d.videos[0].source = "gs://test-only/replaced.mp4";
  expect(digitalHumanProjectSegmentOutputs(d).some(c => c.source.endsWith("adopted.mp4"))).toBe(false);
});
