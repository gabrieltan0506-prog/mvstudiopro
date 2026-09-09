import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveOpenAiGptImage2Model, resolveOpenAiInputFidelity } from "./openaiGptImage2";

afterEach(() => vi.unstubAllEnvs());

describe("resolveOpenAiGptImage2Model", () => {
  it("默认 flare；开关 sunburst 换模型", () => {
    vi.stubEnv("OPENAI_GPT_IMAGE2_MODEL", "");
    expect(resolveOpenAiGptImage2Model()).toBe("gpt-image-2.5-flare");
    expect(resolveOpenAiGptImage2Model("sunburst")).toBe("gpt-image-2.5-sunburst");
  });
  it("env 显式全名整体覆盖（gpt-image-2 旧名 / 2.5 全名都收），乱值忽略", () => {
    vi.stubEnv("OPENAI_GPT_IMAGE2_MODEL", "gpt-image-2-2026-04-21");
    expect(resolveOpenAiGptImage2Model("sunburst")).toBe("gpt-image-2-2026-04-21");
    vi.stubEnv("OPENAI_GPT_IMAGE2_MODEL", "gpt-image-2.5-sunburst");
    expect(resolveOpenAiGptImage2Model("flare")).toBe("gpt-image-2.5-sunburst");
    vi.stubEnv("OPENAI_GPT_IMAGE2_MODEL", "dall-e-9");
    expect(resolveOpenAiGptImage2Model("flare")).toBe("gpt-image-2.5-flare");
  });
  it("2026-09-08 快照全名可用 env 钉死；input_fidelity 默认 high、env 可放宽", () => {
    vi.stubEnv("OPENAI_GPT_IMAGE2_MODEL", "gpt-image-2.5-sunburst-2026-09-08");
    expect(resolveOpenAiGptImage2Model("flare")).toBe("gpt-image-2.5-sunburst-2026-09-08");
    vi.stubEnv("OPENAI_GPT_IMAGE2_INPUT_FIDELITY", "");
    expect(resolveOpenAiInputFidelity()).toBe("high");
    expect(resolveOpenAiInputFidelity("low")).toBe("low");
    vi.stubEnv("OPENAI_GPT_IMAGE2_INPUT_FIDELITY", "low");
    expect(resolveOpenAiInputFidelity()).toBe("low");
  });
});
