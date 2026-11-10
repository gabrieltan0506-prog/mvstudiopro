import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GEMINI_DEFAULT_MODEL_FALLBACK,
  GEMINI_MODEL_DOMAIN_DEFAULTS,
  GEMINI_MODEL_DOMAIN_ENVS,
  geminiModelDomainDefault,
  isGeminiProTierModel,
  resetGeminiModelConfigWarningsForTest,
  resolveGeminiModel,
  type GeminiModelDomain,
} from "./geminiModelConfig";

/** 1110 用户令：Gemini 模型集中解析（全局缺省 + 各领域可选覆盖），调用处不写死。 */
describe("resolveGeminiModel", () => {
  const domains = Object.keys(GEMINI_MODEL_DOMAIN_ENVS) as GeminiModelDomain[];
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetGeminiModelConfigWarningsForTest();
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => { warn.mockRestore(); vi.unstubAllEnvs(); });

  const pinned = new Set(Object.keys(GEMINI_MODEL_DOMAIN_DEFAULTS));
  it("无领域缺省的领域一律 gemini-3.8-flash", () => {
    expect(GEMINI_DEFAULT_MODEL_FALLBACK).toBe("gemini-3.8-flash");
    for (const domain of domains.filter((d) => !pinned.has(d))) expect(resolveGeminiModel(domain, {})).toBe("gemini-3.8-flash");
    expect(warn).not.toHaveBeenCalled();
  });

  it("1110c 领域缺省：保持原写死值（行为不变）", () => {
    expect(GEMINI_MODEL_DOMAIN_DEFAULTS).toEqual({
      llmProTier: "gemini-3.1-pro-preview",
      llmFlashTier: "gemini-2.5-flash",
      platformStage2: "gemini-3.1-pro-preview",
      flashCopywriting: "gemini-3-flash-preview",
      compositeFlashTranslation: "gemini-3-flash-preview",
      coverTranslation: "gemini-3-flash-preview",
      strategicCoverDirector: "gemini-3.1-pro-preview",
      deepResearchAssist: "gemini-3.1-pro",
      growthCampExtractor: "gemini-3.5-flash",
    });
    for (const domain of Array.from(pinned)) {
      expect(GEMINI_MODEL_DOMAIN_ENVS).toHaveProperty(domain);
      const d = domain as GeminiModelDomain;
      expect(resolveGeminiModel(d, {})).toBe(geminiModelDomainDefault(d));
    }
    expect(geminiModelDomainDefault("audioTwoHop")).toBe("gemini-3.8-flash");
  });

  it("领域缺省优先于 GEMINI_DEFAULT_MODEL；领域 env 仍可覆盖", () => {
    const env = { GEMINI_DEFAULT_MODEL: "gemini-3.8-flash" };
    expect(resolveGeminiModel("llmProTier", env)).toBe("gemini-3.1-pro-preview");
    expect(resolveGeminiModel("growthCampExtractor", env)).toBe("gemini-3.5-flash");
    expect(resolveGeminiModel("audioTwoHop", env)).toBe("gemini-3.8-flash");
    expect(resolveGeminiModel("llmProTier", { LLM_GEMINI_PRO_TIER_MODEL: "gemini-3.8-flash" })).toBe("gemini-3.8-flash");
    expect(resolveGeminiModel("llmFlashTier", { LLM_GEMINI_FLASH_TIER_MODEL: "gemini-3.8-flash" })).toBe("gemini-3.8-flash");
    expect(resolveGeminiModel("deepResearchAssist", { DEEP_RESEARCH_ASSIST_GEMINI_MODEL: "gemini-3.8-flash" })).toBe("gemini-3.8-flash");
    expect(resolveGeminiModel("strategicCoverDirector", { STRATEGIC_COVER_DIRECTOR_GEMINI_MODEL: "gemini-3.8-flash", VERTEX_GEMINI_31_PRO_MODEL: "gemini-3.1-pro-preview" })).toBe("gemini-3.8-flash");
  });

  it("旧 env 兼容", () => {
    expect(resolveGeminiModel("platformStage2", { PLATFORM_STAGE2_GEMINI_MODEL: "gemini-3.8-flash" })).toBe("gemini-3.8-flash");
    expect(resolveGeminiModel("growthCampExtractor", { GROWTH_CAMP_EXTRACTOR_MODEL: "gemini-3.8-flash" })).toBe("gemini-3.8-flash");
    // VERTEX_GEMINI_MODEL 原本两档共用：仍覆盖两档，但新档位 env 更具体、优先
    const vx = { VERTEX_GEMINI_MODEL: "gemini-3.9-flash" };
    expect(resolveGeminiModel("llmProTier", vx)).toBe("gemini-3.9-flash");
    expect(resolveGeminiModel("llmFlashTier", vx)).toBe("gemini-3.9-flash");
    expect(resolveGeminiModel("llmProTier", { ...vx, LLM_GEMINI_PRO_TIER_MODEL: "gemini-4.0-flash" })).toBe("gemini-4.0-flash");
    expect(resolveGeminiModel("strategicCoverDirector", { VERTEX_GEMINI_31_PRO_MODEL: "gemini-3.9-flash", VERTEX_GEMINI_MODEL: "gemini-4.0-flash" })).toBe("gemini-3.9-flash");
    expect(resolveGeminiModel("strategicCoverDirector", vx)).toBe("gemini-3.9-flash");
    // Flash 文案旧链顺序原样
    expect(resolveGeminiModel("flashCopywriting", { VERTEX_GEMINI_COVER_TRANSLATION_MODEL: "gemini-a", GROWTH_CAMP_EXTRACTOR_MODEL: "gemini-b" })).toBe("gemini-b");
    expect(resolveGeminiModel("compositeFlashTranslation", { VERTEX_GEMINI_FLASH_TRANSLATION_MODEL: "gemini-a", GEMINI_35_FLASH_MODEL: "gemini-b" })).toBe("gemini-a");
    expect(resolveGeminiModel("coverTranslation", { VERTEX_GEMINI_COVER_TRANSLATION_MODEL: "gemini-a", GEMINI_35_FLASH_MODEL: "gemini-b" })).toBe("gemini-a");
    expect(resolveGeminiModel("deepResearchAssist", { GEMINI_DEFAULT_MODEL: "gemini-3.8-flash" })).toBe("gemini-3.1-pro");
  });

  it("领域缺省为 Pro 时同样告警（来自 领域缺省），只记一次", () => {
    resolveGeminiModel("llmProTier", {});
    resolveGeminiModel("llmProTier", {});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/llmProTier.*领域缺省.*批准/);
  });

  it("GEMINI_DEFAULT_MODEL 改全局；领域 env 只改该领域；读取时 trim、空白回落", () => {
    const env = { GEMINI_DEFAULT_MODEL: " gemini-3.9-flash ", MONTAGE_GRADE_ADVICE_MODEL: "gemini-4.0-flash", MV_SONG_HEARING_MODEL: "  " };
    expect(resolveGeminiModel("montageGradeAdvice", env)).toBe("gemini-4.0-flash");
    expect(resolveGeminiModel("mvSongHearing", env)).toBe("gemini-3.9-flash");
    expect(resolveGeminiModel("audioTwoHop", env)).toBe("gemini-3.9-flash");
    expect(resolveGeminiModel("manhuaDeepRead", env)).toBe("gemini-3.9-flash");
    expect(resolveGeminiModel("audioTwoHop", { GEMINI_AUDIO_TWO_HOP_MODEL: "gemini-3.9-flash-lite" })).toBe("gemini-3.9-flash-lite");
    expect(resolveGeminiModel("manhuaDeepRead", { MANHUA_DEEP_READ_MODEL: "gemini-3.9-flash" })).toBe("gemini-3.9-flash");
    expect(resolveGeminiModel("audioTwoHop", { GEMINI_DEFAULT_MODEL: "", GEMINI_AUDIO_TWO_HOP_MODEL: "\t" })).toBe("gemini-3.8-flash");
  });

  it("精读升级模型：自身 env → 精读模型 env → 全局缺省", () => {
    expect(resolveGeminiModel("manhuaDeepReadEscalation", { GEMINI_DEFAULT_MODEL: "gemini-3.9-flash" })).toBe("gemini-3.9-flash");
    expect(resolveGeminiModel("manhuaDeepReadEscalation", { MANHUA_DEEP_READ_MODEL: "gemini-4.0-flash" })).toBe("gemini-4.0-flash");
    expect(resolveGeminiModel("manhuaDeepReadEscalation", { MANHUA_DEEP_READ_MODEL: "gemini-4.0-flash", MANHUA_DEEP_READ_ESCALATION_MODEL: "gemini-4.1-flash" })).toBe("gemini-4.1-flash");
  });

  it("默认读 process.env（改 env 即生效，无需改代码）", () => {
    vi.stubEnv("GEMINI_DEFAULT_MODEL", "");
    vi.stubEnv("MV_SONG_HEARING_MODEL", "");
    expect(resolveGeminiModel("mvSongHearing")).toBe("gemini-3.8-flash");
    vi.stubEnv("MV_SONG_HEARING_MODEL", "gemini-3.9-flash");
    expect(resolveGeminiModel("mvSongHearing")).toBe("gemini-3.9-flash");
  });

  it("Pro 级（名称含 pro）记一条 console.warn 但不阻断；同一领域同一模型只记一次", () => {
    expect(isGeminiProTierModel("gemini-3.1-pro-preview")).toBe(true);
    expect(isGeminiProTierModel("gemini-3.8-flash")).toBe(false);
    expect(resolveGeminiModel("montageGradeAdvice", { MONTAGE_GRADE_ADVICE_MODEL: "gemini-3.1-pro-preview" })).toBe("gemini-3.1-pro-preview");
    expect(resolveGeminiModel("montageGradeAdvice", { MONTAGE_GRADE_ADVICE_MODEL: "gemini-3.1-pro-preview" })).toBe("gemini-3.1-pro-preview");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/Pro 级.*批准/);
    resolveGeminiModel("manhuaDeepRead", { GEMINI_DEFAULT_MODEL: "gemini-3.1-pro-preview" });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("非 Gemini / 非法标识不送进 Gemini 端点：告警并回落下一级", () => {
    expect(resolveGeminiModel("manhuaDeepRead", { MANHUA_DEEP_READ_MODEL: "glm-5.3", GEMINI_DEFAULT_MODEL: "gemini-3.9-flash" })).toBe("gemini-3.9-flash");
    expect(resolveGeminiModel("audioTwoHop", { GEMINI_AUDIO_TWO_HOP_MODEL: "gemini-x/../evil" })).toBe("gemini-3.8-flash");
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
