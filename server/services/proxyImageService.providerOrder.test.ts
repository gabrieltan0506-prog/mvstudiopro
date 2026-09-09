import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./proxyImageService.ts", import.meta.url), "utf8");
const platform = readFileSync(new URL("../../client/src/pages/PlatformPage.tsx", import.meta.url), "utf8");

describe("gpt-image-2 供应商顺序接线（0909：OpenAI 官方 → WaveSpeed → EvoLink）", () => {
  it("三家都进候选，主路径日志写官方优先，知识卡默认 openai", () => {
    expect(src).toContain('if (p === "wavespeed") return wavespeedReady;');
    expect(src).toContain("主路径(官方优先)");
    expect(src).toContain('providerOverride: isKnowledgeCard ? (options.knowledgeCardImageProvider || "openai") : undefined');
    expect(src).not.toContain('|| "evolink") : undefined');
    expect(src).toContain("variant: options.openaiImageVariant ?? null");
  });
  it("知识卡前端不再奇偶页轮流分给 EvoLink/OpenAI", () => {
    expect(platform).not.toContain('idx % 2 === 0 ? "evolink" : "openai"');
    expect(platform).not.toContain('i % 2 === 0 ? "evolink" : "openai"');
    expect(platform).toContain("openaiImageVariant: readOpenAiImageVariantPref()");
  });
  it("主路径为官方时不竞速；unknown 结果停止回落", () => {
    expect(src).toContain('provider !== "openai"');
    expect(src).toContain("停止回落");
  });
});
