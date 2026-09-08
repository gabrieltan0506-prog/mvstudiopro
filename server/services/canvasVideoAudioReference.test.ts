import { describe, expect, it, vi } from "vitest";
import { resolveCanvasVideoAudioReference } from "./canvasVideoAudioReference";
import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource";
import { resolveTokenPlanDialogueAudioReference } from "./tokenPlanDialogueTts";

function dependencies() {
  const sign = vi.fn((uri: string, seconds?: number) => `https://storage.googleapis.com/${uri.slice(5)}?ttl=${seconds}`);
  return {
    sign,
    legacy: (input: Parameters<typeof resolveTokenPlanDialogueAudioReference>[0]) => resolveTokenPlanDialogueAudioReference({ ...input, bucketName: "test-bucket", sign }),
    register: (input: { userId: string; source: string }) => resolveRegisteredPostProdMediaSource(input, {
      getBucket: () => "test-bucket", verifyOwnership: async () => false, loadSucceededJobOutputObjects: async () => new Set(),
    }),
  };
}

describe("成片参考音频长期身份与实际读取地址", () => {
  it("本人后期音频验权后现签，但任务仍保存GS身份", async () => {
    const deps = dependencies();
    const source = "gs://test-bucket/post-prod/7/20260908/dialogue.wav";
    expect(await resolveCanvasVideoAudioReference({ reference: source, ownerUserId: 7 }, deps)).toEqual({
      storedReference: source, url: "https://storage.googleapis.com/test-bucket/post-prod/7/20260908/dialogue.wav?ttl=86400",
    });
    expect(deps.sign).toHaveBeenCalledWith(source, 86400);
  });
  it("拒绝另一用户、另桶、路径穿越与未登记对象，拒绝前不签名", async () => {
    for (const source of ["gs://test-bucket/post-prod/8/a.wav", "gs://other/post-prod/7/a.wav", "gs://test-bucket/post-prod/7/../8/a.wav", "gs://test-bucket/random.wav"]) {
      const deps = dependencies();
      await expect(resolveCanvasVideoAudioReference({ reference: source, ownerUserId: 7 }, deps)).rejects.toThrow();
      expect(deps.sign).not.toHaveBeenCalled();
    }
  });
  it("旧HTTPS不变，旧token-plan仍按原本人前缀签名", async () => {
    const deps = dependencies();
    const https = "https://example.com/legacy.mp3?old=1";
    expect(await resolveCanvasVideoAudioReference({ reference: https, ownerUserId: 7 }, deps)).toEqual({ storedReference: https, url: https });
    const token = await resolveCanvasVideoAudioReference({ reference: "gs://test-bucket/manhua-dialogue-tts/token-plan/u7/a.mp3", ownerUserId: 7 }, deps);
    expect(token.storedReference).toBe(token.url);
    expect(token.url).toContain("https://storage.googleapis.com/test-bucket/manhua-dialogue-tts/token-plan/u7/a.mp3");
    await expect(resolveCanvasVideoAudioReference({ reference: "gs://test-bucket/manhua-dialogue-tts/token-plan/u8/a.mp3", ownerUserId: 7 }, deps)).rejects.toThrow();
  });
});
