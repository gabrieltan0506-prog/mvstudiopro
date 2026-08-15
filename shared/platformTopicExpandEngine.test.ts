/** 引擎归一化单一真源测试（审查返工 7：三处各自 fallback 到 kimi 曾让经济档不可达） */
import { describe, expect, it } from "vitest";
import {
  PLATFORM_TOPIC_EXPAND_ENGINES,
  normalizePlatformTopicExpandEngine,
} from "./platformTopicShortlist";
import { buildDeepSeekExpandRequestBody } from "../server/services/platformTopicShortlist";

describe("normalizePlatformTopicExpandEngine", () => {
  it("三档全部保真（含经济档，曾被降级为 kimi 的 P0）", () => {
    for (const e of PLATFORM_TOPIC_EXPAND_ENGINES) {
      expect(normalizePlatformTopicExpandEngine(e)).toBe(e);
    }
    expect(normalizePlatformTopicExpandEngine("deepseek-v4")).toBe("deepseek-v4");
  });
  it("未知/空值回落稳定档", () => {
    expect(normalizePlatformTopicExpandEngine("")).toBe("kimi-k3");
    expect(normalizePlatformTopicExpandEngine(null)).toBe("kimi-k3");
    expect(normalizePlatformTopicExpandEngine("gpt-99")).toBe("kimi-k3");
  });
});

describe("buildDeepSeekExpandRequestBody（缰绳纪律固化）", () => {
  const body = buildDeepSeekExpandRequestBody({ system: "s", user: "u" });
  it("65K 预算 + 推理 high + json_object + require_parameters 一个不少", () => {
    expect(body.max_tokens).toBe(65_536);
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.model).toBe("deepseek/deepseek-v4-pro-0813");
  });
});
