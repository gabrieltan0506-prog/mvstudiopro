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
  it("OpenRouter 主路：GLM 5.3 + 65K 预算 + 推理 high + json_object + 锁 Z.AI 自营", () => {
    expect(body.max_tokens).toBe(65_536);
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.response_format).toEqual({ type: "json_object" });
    // 0911 用户令：锁 Z.AI 自营且不许回落；require_parameters 仍在，防参数被静默忽略
    expect(body.provider).toEqual({ order: ["Z.AI"], allow_fallbacks: false, require_parameters: true });
    // 长文本旗舰 GLM 5.3，不是读图的 GLM 5.3 Flash
    expect(body.model).toBe("z-ai/glm-5.3");
  });

  it("EvoLink 兜底：同款 glm-5.3，档位走顶层 reasoning_effort、不带 provider", () => {
    const evo = buildDeepSeekExpandRequestBody({ system: "s", user: "u", gateway: "evolink" });
    expect(evo.model).toBe("glm-5.3");
    expect(evo.reasoning_effort).toBe("high");
    expect(evo.max_tokens).toBe(65_536);
    expect(evo.response_format).toEqual({ type: "json_object" });
    expect("provider" in evo).toBe(false);
    expect("reasoning" in evo).toBe(false);
  });
});
