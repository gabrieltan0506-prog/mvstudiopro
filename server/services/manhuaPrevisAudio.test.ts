import { expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createManhuaPrevisStudio, type ManhuaPrevisRequest } from "../../shared/manhuaPrevis";
import { preparePrevisAudio } from "./manhuaPrevisAudio";
const audio = { version: 1 as const, startSec: 0, durationSec: 2, sourceKey: "test", dialogueCount: 1, bgmCount: 0, clips: [{ audioUri: "gs://test/audio.wav", sourceStartSec: 0, sourceEndSec: 1, startSec: 0, volume: 1, fadeInSec: 0, fadeOutSec: 0 }] };
const request: ManhuaPrevisRequest = { requestId: "11111111-1111-4111-8111-111111111111", scopeId: "22222222-2222-4222-8222-222222222222", clipId: "test", spec: createManhuaPrevisStudio(2).spec, audio };
it("未授权素材在下载和渲染前拒绝", async () => {
  const fetch = vi.fn(), run = vi.fn();
  await expect(preparePrevisAudio(request, "7", "/not-used", new AbortController().signal, { run, fetch, validate: async () => { throw new Error("素材尚未登记"); } })).rejects.toThrow("尚未登记");
  expect(fetch).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
});
it("真实源长度不足不能补静音伪造对白", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "previs-audio-test-"));
  const run = vi.fn(async () => JSON.stringify({ streams: [{ codec_type: "audio", duration: .5 }] }));
  try { await expect(preparePrevisAudio(request, "7", dir, new AbortController().signal, { run, fetch: async () => 1, validate: async () => {} })).rejects.toThrow("源长度不足"); expect(run).toHaveBeenCalledTimes(1); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
