import { describe, expect, it } from "vitest";
import {
  compareGptImage2ProviderCost,
  resolveGptImage2ProviderOrder,
} from "./gptImage2ProviderPricing.js";
import { isTimeoutLikeError, racePrimaryTimeout } from "./providerPrimaryTimeout.js";

describe("gptImage2ProviderPricing", () => {
  it("EvoLink image-output 更便宜 → auto 主路径 evolink", () => {
    const c = compareGptImage2ProviderCost();
    expect(c.cheaper).toBe("evolink");
    expect(c.dearer).toBe("openai");
    expect(c.evolinkImageOutput).toBeLessThan(c.openaiImageOutput);
    expect(resolveGptImage2ProviderOrder("auto")).toEqual(["evolink", "openai"]);
  });

  it("显式 openai 仍把 evolink 留作 fallback 序", () => {
    expect(resolveGptImage2ProviderOrder("openai")).toEqual(["openai", "evolink"]);
  });
});

describe("racePrimaryTimeout", () => {
  it("超时抛错且文案可识别", async () => {
    await expect(
      racePrimaryTimeout(new Promise(() => {}), 30, "OpenAI"),
    ).rejects.toThrow(/主路径超时/);
  });

  it("识别 timeout 类错误", () => {
    expect(isTimeoutLikeError(new Error("LLM 请求超时，已等待 100ms"))).toBe(true);
    expect(isTimeoutLikeError(new Error("OpenAI 主路径超时（75000ms），切换备胎"))).toBe(true);
    expect(isTimeoutLikeError(new Error("bad request"))).toBe(false);
  });
});
