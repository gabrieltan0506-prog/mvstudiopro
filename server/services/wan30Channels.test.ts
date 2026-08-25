/**
 * Wan 3.0 三通道路由回归：载荷字段按官方契约锁死 / 资格检查（锁音轨不进 OpenRouter）/
 * 明确拒绝才回落、结果未知禁止回落（一单双烧防线）。
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildEvolinkWanRequestBody,
  buildOpenRouterWanSubmitBody,
  openRouterWanEligible,
  submitWan30ViaChannels,
  Wan30SubmitRejectedError,
  Wan30SubmitUnknownError,
  type Wan30ChannelDeps,
} from "./wan30Channels";
import { OpenRouterSubmitRejectedError, OpenRouterSubmitUnknownError } from "./openrouterVideoCore";

const IMG = ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"];
const AUD = ["https://cdn.example.com/ref.mp3"];
const baseInput = { prompt: "夜市灯笼下的乐队", imageUrls: IMG };

function deps(over: Partial<Wan30ChannelDeps>): Wan30ChannelDeps {
  return {
    openrouterConfigured: () => true,
    evolinkConfigured: () => true,
    wavespeedConfigured: () => true,
    submitOpenrouter: vi.fn(async () => ({
      openRouterJobId: "or_1",
      pollingUrl: "https://openrouter.ai/api/v1/videos/or_1",
      apiKey: "k",
    })),
    submitEvolink: vi.fn(async () => ({ evolinkTaskId: "ev_1" })),
    submitWavespeed: vi.fn(async () => ({ predictionId: "ws_1" })),
    ...over,
  };
}

describe("载荷字段（官方契约，不是猜的）", () => {
  it("EvoLink：model/image_urls/audio_urls/quality/aspect_ratio 逐字段锁死；音频进 audio_urls", () => {
    const body = buildEvolinkWanRequestBody({
      ...baseInput,
      audioUrls: AUD,
      duration: 22,
      resolution: "720p",
      aspectRatio: "9:16",
      seed: 7,
    });
    expect(body).toMatchObject({
      model: "wan3.0-reference-video",
      image_urls: IMG,
      audio_urls: AUD,
      duration: 22,
      quality: "720p",
      aspect_ratio: "9:16",
      generate_audio: true,
      seed: 7,
    });
    expect(body).not.toHaveProperty("reference_images");
    expect(body).not.toHaveProperty("resolution");
  });

  it("OpenRouter：参考图走 input_references（image_url 结构），无任何参考音频字段（generate_audio 音效开关除外）", () => {
    const body = buildOpenRouterWanSubmitBody({ ...baseInput, duration: 30, aspectRatio: "16:9" });
    expect(body.model).toBe("alibaba/wan-3.0");
    expect(body.input_references).toEqual(
      IMG.map((url) => ({ type: "image_url", image_url: { url } })),
    );
    expect(body).not.toHaveProperty("audio_urls");
    expect(body).not.toHaveProperty("reference_audios");
    expect(body.generate_audio).toBe(true);
  });

  it("两家 builder 都拒绝零参考图（canvas Wan 口径：至少一张）", () => {
    expect(() => buildEvolinkWanRequestBody({ prompt: "p", imageUrls: [] })).toThrow("参考图");
    expect(() => buildOpenRouterWanSubmitBody({ prompt: "p", imageUrls: [] })).toThrow("参考图");
  });
});

describe("OpenRouter 资格检查（0824 锁音轨事故的防线）", () => {
  it("默认：带参考音频 → 无资格；纯图 → 有资格", () => {
    expect(openRouterWanEligible({ ...baseInput, audioUrls: AUD }).ok).toBe(false);
    expect(openRouterWanEligible(baseInput).ok).toBe(true);
  });

  it("WAN30_OPENROUTER_ALLOW_AUDIO=1（真单验证后）：音频放行且以 reference_audios 随单", () => {
    vi.stubEnv("WAN30_OPENROUTER_ALLOW_AUDIO", "1");
    try {
      expect(openRouterWanEligible({ ...baseInput, audioUrls: AUD }).ok).toBe(true);
      const body = buildOpenRouterWanSubmitBody({ ...baseInput, audioUrls: AUD });
      expect(body.reference_audios).toEqual(AUD);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("旗未开时 body 绝无音频字段（防静默丢锁音轨）", () => {
    const body = buildOpenRouterWanSubmitBody(baseInput);
    expect(body).not.toHaveProperty("reference_audios");
    expect(body).not.toHaveProperty("audio_urls");
  });
});

describe("submitWan30ViaChannels 回落纪律", () => {
  it("默认顺序 OpenRouter 先行，成功即停，其余通道零调用", async () => {
    const d = deps({});
    const r = await submitWan30ViaChannels(baseInput, d);
    expect(r.submitted.channel).toBe("openrouter");
    expect(d.submitEvolink).not.toHaveBeenCalled();
    expect(d.submitWavespeed).not.toHaveBeenCalled();
  });

  it("🔴 带参考音频：跳过 OpenRouter（零调用）直落 EvoLink——锁音轨绝不静默丢", async () => {
    const d = deps({});
    const r = await submitWan30ViaChannels({ ...baseInput, audioUrls: AUD }, d);
    expect(r.submitted.channel).toBe("evolink");
    expect(d.submitOpenrouter).not.toHaveBeenCalled();
    expect(r.skippedZh.join("")).toContain("参考音频");
  });

  it("OpenRouter 明确 4xx 拒绝 → 安全回落 EvoLink", async () => {
    const d = deps({
      submitOpenrouter: vi.fn(async () => { throw new OpenRouterSubmitRejectedError("HTTP 400 bad field"); }),
    });
    const r = await submitWan30ViaChannels(baseInput, d);
    expect(r.submitted.channel).toBe("evolink");
    expect(r.skippedZh.join("")).toContain("明确拒绝");
  });

  it("🔴 OpenRouter 结果未知（可能已建单）→ 禁止回落，异常上抛，后两家零调用", async () => {
    const d = deps({
      submitOpenrouter: vi.fn(async () => { throw new OpenRouterSubmitUnknownError("网络断"); }),
    });
    await expect(submitWan30ViaChannels(baseInput, d)).rejects.toThrow("网络断");
    expect(d.submitEvolink).not.toHaveBeenCalled();
    expect(d.submitWavespeed).not.toHaveBeenCalled();
  });

  it("EvoLink 明确拒绝 → 落 WaveSpeed；EvoLink 结果未知 → 停手", async () => {
    const rejected = deps({
      submitOpenrouter: vi.fn(async () => { throw new OpenRouterSubmitRejectedError("400"); }),
      submitEvolink: vi.fn(async () => { throw new Wan30SubmitRejectedError("HTTP 422"); }),
    });
    const r = await submitWan30ViaChannels(baseInput, rejected);
    expect(r.submitted.channel).toBe("wavespeed");

    const unknown = deps({
      submitOpenrouter: vi.fn(async () => { throw new OpenRouterSubmitRejectedError("400"); }),
      submitEvolink: vi.fn(async () => { throw new Wan30SubmitUnknownError("HTTP 500"); }),
    });
    await expect(submitWan30ViaChannels(baseInput, unknown)).rejects.toThrow("500");
    expect(unknown.submitWavespeed).not.toHaveBeenCalled();
  });

  it("未配置的通道跳过并留痕；全部不可用时报出每家原因", async () => {
    const d = deps({
      openrouterConfigured: () => false,
      evolinkConfigured: () => false,
      wavespeedConfigured: () => false,
    });
    await expect(submitWan30ViaChannels(baseInput, d)).rejects.toThrow("三通道均不可用");
  });

  it("WaveSpeed 收到的载荷保持老口径（enableAudio/thinkingMode 透传）", async () => {
    const d = deps({
      openrouterConfigured: () => false,
      evolinkConfigured: () => false,
    });
    await submitWan30ViaChannels({ ...baseInput, generateAudio: false, thinkingMode: false }, d);
    expect(d.submitWavespeed).toHaveBeenCalledWith(
      expect.objectContaining({ enableAudio: false, thinkingMode: false, imageUrls: IMG }),
    );
  });
});
