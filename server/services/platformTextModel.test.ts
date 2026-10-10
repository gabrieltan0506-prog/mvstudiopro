import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlatformTextModel, PLATFORM_TEXT_MODEL, PLATFORM_TEXT_REASONING_EFFORT, resolvePlatformTextMaxCompletionTokens } from "./platformTextModel";
import { isRetiredKimiModel, migrateRetiredTextModel } from "../../shared/textModelPolicy";
import { getPlatformStage2OpenAiModel } from "../config/platformSwitches";
afterEach(() => vi.unstubAllEnvs());
describe("下架模型迁移", () => {
  it.each(["kimi-k3", "moonshotai/kimi-k3", "moonshotai/kimi-k3:free"])("旧配置 %s 只能迁到GLM", old => {
    expect(isRetiredKimiModel(old)).toBe(true); expect(migrateRetiredTextModel(old)).toBe(PLATFORM_TEXT_MODEL);
    vi.stubEnv("PLATFORM_OPENROUTER_MODEL", old); expect(getPlatformTextModel()).toBe(PLATFORM_TEXT_MODEL); expect(getPlatformStage2OpenAiModel()).toBe(PLATFORM_TEXT_MODEL);
  });
  it("新默认为GLM low与32k，保留显式其他模型", () => {
    for (const key of ["PLATFORM_OPENROUTER_MODEL", "VISUAL_REPORT_OPENROUTER_MODEL", "VISUAL_REPORT_OPENAI_MODEL", "PLATFORM_TEXT_MAX_COMPLETION_TOKENS"]) vi.stubEnv(key, "");
    expect(getPlatformTextModel()).toBe(PLATFORM_TEXT_MODEL); expect(PLATFORM_TEXT_REASONING_EFFORT).toBe("low"); expect(resolvePlatformTextMaxCompletionTokens()).toBe(32768);
    expect(migrateRetiredTextModel("deepseek/deepseek-v4.1-flash")).toBe("deepseek/deepseek-v4.1-flash");
  });
});
