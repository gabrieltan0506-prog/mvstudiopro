import { describe, expect, it } from "vitest";
import {
  compareGptImage2ProviderCost,
  resolveGptImage2ProviderOrder,
} from "./gptImage2ProviderPricing.js";
import { isTimeoutLikeError, racePrimaryTimeout } from "./providerPrimaryTimeout.js";

describe("gptImage2ProviderPricing", () => {
  it("牌价表仍是 EvoLink 更便宜，但顺序不再按牌价：0909 拍板官方优先", () => {
    const c = compareGptImage2ProviderCost();
    expect(c.cheaper).toBe("evolink");
    expect(resolveGptImage2ProviderOrder("auto")).toEqual(["openai", "wavespeed", "evolink"]);
    expect(resolveGptImage2ProviderOrder(undefined)).toEqual(["openai", "wavespeed", "evolink"]);
  });

  it("显式主路径只换头，其余两家按固定序兜底", () => {
    expect(resolveGptImage2ProviderOrder("openai")).toEqual(["openai", "wavespeed", "evolink"]);
    expect(resolveGptImage2ProviderOrder("wavespeed")).toEqual(["wavespeed", "openai", "evolink"]);
    expect(resolveGptImage2ProviderOrder("evolink")).toEqual(["evolink", "openai", "wavespeed"]);
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
