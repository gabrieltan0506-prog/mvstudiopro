/**
 * HappyHorse 三通道路由回归（0825 拆百炼）：载荷按官方 i2v 契约锁死 /
 * EvoLink 优先顺序 / pin 钉通道 / 明确拒绝回落、结果未知禁回落 / 友好全败文案。
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildEvolinkHappyHorseRequestBody,
  buildWavespeedHappyHorseRequestBody,
  submitHappyHorseViaChannels,
  type HappyHorseChannelDeps,
} from "./happyHorseChannels";
import { SubmitRejectedError, SubmitUnknownError } from "./submitOutcomeErrors";

const IMG = "https://cdn.example.com/face.png";
const baseInput = { prompt: "让照片中的人物自然微动", imageUrl: IMG };

function deps(over: Partial<HappyHorseChannelDeps>): HappyHorseChannelDeps {
  return {
    evolinkConfigured: () => true,
    openrouterConfigured: () => true,
    wavespeedConfigured: () => true,
    submitEvolink: vi.fn(async () => ({ evolinkTaskId: "ev_hh_1" })),
    submitOpenrouter: vi.fn(async () => ({
      openRouterJobId: "or_1",
      pollingUrl: "https://openrouter.ai/api/v1/videos/or_1",
      apiKey: "k",
      model: "alibaba/happyhorse-1.1",
    })),
    submitWavespeed: vi.fn(async () => ({ predictionId: "ws_hh_1" })),
    ...over,
  };
}

describe("载荷字段（官方 i2v 契约：首帧语义，不是 r2v 参考语义）", () => {
  it("EvoLink：model=happyhorse-1.1-image-to-video / image_urls[0]=首帧 / quality / 无 aspect_ratio", () => {
    const body = buildEvolinkHappyHorseRequestBody({ ...baseInput, duration: 10, resolution: "1080p", seed: 7 });
    expect(body).toMatchObject({
      model: "happyhorse-1.1-image-to-video",
      image_urls: [IMG],
      duration: 10,
      quality: "1080p",
      seed: 7,
    });
    // 官方契约：画幅随首帧图，不收 aspect_ratio（与原百炼官方一致）
    expect(body).not.toHaveProperty("aspect_ratio");
    expect(body).not.toHaveProperty("resolution");
  });

  it("WaveSpeed：image=首帧单值 / resolution / duration 钳 3–15", () => {
    const body = buildWavespeedHappyHorseRequestBody({ ...baseInput, duration: 99, resolution: "720p" });
    expect(body).toMatchObject({ image: IMG, duration: 15, resolution: "720p" });
    expect(body).not.toHaveProperty("images");
    expect(body).not.toHaveProperty("image_urls");
  });
});

describe("submitHappyHorseViaChannels 路由纪律", () => {
  it("默认顺序 EvoLink 先行（用户拍板），成功即停", async () => {
    const d = deps({});
    const r = await submitHappyHorseViaChannels(baseInput, d);
    expect(r.submitted.channel).toBe("evolink");
    expect(d.submitOpenrouter).not.toHaveBeenCalled();
    expect(d.submitWavespeed).not.toHaveBeenCalled();
  });

  it("EvoLink 明确拒绝 → 回落 OpenRouter；再拒 → WaveSpeed", async () => {
    const d = deps({
      submitEvolink: vi.fn(async () => { throw new SubmitRejectedError("HTTP 422"); }),
      submitOpenrouter: vi.fn(async () => { throw new SubmitRejectedError("HTTP 400"); }),
    });
    const r = await submitHappyHorseViaChannels(baseInput, d);
    expect(r.submitted.channel).toBe("wavespeed");
    expect(r.skippedZh.join("")).toContain("明确拒绝");
  });

  it("🔴 EvoLink 结果未知（可能已建单）→ 禁止回落，后两家零调用", async () => {
    const d = deps({
      submitEvolink: vi.fn(async () => { throw new SubmitUnknownError("网络断"); }),
    });
    await expect(submitHappyHorseViaChannels(baseInput, d)).rejects.toThrow("网络断");
    expect(d.submitOpenrouter).not.toHaveBeenCalled();
    expect(d.submitWavespeed).not.toHaveBeenCalled();
  });

  it("pinChannel 钉死原通道：崩溃恢复不跨家双建单", async () => {
    const d = deps({});
    const r = await submitHappyHorseViaChannels(baseInput, d, "wavespeed");
    expect(r.submitted.channel).toBe("wavespeed");
    expect(d.submitEvolink).not.toHaveBeenCalled();
    expect(d.submitOpenrouter).not.toHaveBeenCalled();
  });

  it("全部不可用：业务友好句，不含供应商名（规范§一）", async () => {
    const d = deps({
      evolinkConfigured: () => false,
      openrouterConfigured: () => false,
      wavespeedConfigured: () => false,
    });
    const err = await submitHappyHorseViaChannels(baseInput, d).catch((e) => e);
    expect(err.message).toBe("照片动画通道暂时不可用，请稍后重试");
    expect(err.message).not.toMatch(/openrouter|evolink|wavespeed|bailian|百炼/i);
  });
});
