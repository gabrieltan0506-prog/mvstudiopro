import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./proxyImageService.ts", import.meta.url), "utf8");
const platform = readFileSync(new URL("../../client/src/pages/PlatformPage.tsx", import.meta.url), "utf8");

describe("gpt-image 供应商顺序接线（0910：OpenAI 官方 → EvoLink 2.5 → WaveSpeed）", () => {
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
  it("改图带 input_fidelity；xhigh/max 只给官方，其余家折回 high", () => {
    const openai = readFileSync(new URL("./openaiGptImage2.ts", import.meta.url), "utf8");
    expect(openai).toContain('addField("input_fidelity", inputFidelity)');
    expect((src.match(/quality: openaiQuality \?\? qualityForCall/g) || []).length).toBe(2);
    const evo = readFileSync(new URL("./evolinkGptImage2.ts", import.meta.url), "utf8");
    expect(evo).toContain("resolveEvolinkGptImageModel(opts.variant)");
    expect(src).toContain('qualityRaw === "xhigh" || qualityRaw === "max"');
  });
  it("结果未知：runner 不退款转对账；整链重试不再烧；超时不换钥", () => {
    const runner = readFileSync(new URL("../jobs/runner.ts", import.meta.url), "utf8");
    expect(runner).toContain('(err as { kind?: string } | null)?.kind === "unknown"');
    expect(runner).toContain("markSettlementPending(");
    expect(src).toContain("不重试，原样上抛转对账");
    const pool = readFileSync(new URL("./openaiImageKeyPool.ts", import.meta.url), "utf8");
    expect(pool).toContain("KEY_TIMEOUT_RE.test(msg)");
  });
  it("三家串行墙钟 ≥20 分钟；知识卡/2×4 路径 unknown 不退款转对账", () => {
    const runner = readFileSync(new URL("../jobs/runner.ts", import.meta.url), "utf8");
    expect(runner).toContain("CANVAS_GPT_IMAGE2_MIN_TIMEOUT_MS = 20 * 60_000");
    expect(runner).toContain("CANVAS_GPT_IMAGE2_DEFAULT_TIMEOUT_MS = 25 * 60_000");
    const routers = readFileSync(new URL("../routers.ts", import.meta.url), "utf8");
    expect((routers.match(/holdCompositeForReconcile\(error\)/g) || []).length).toBe(2);
    expect(routers).toContain('markSettlementPending(compositeHoldJobId, "platformCompositeSheet")');
  });
  it("知识卡/2×4 整链墙钟 25 分钟；客户端两轮轮询盖过 worker；EvoLink 轮询到点也是 unknown", () => {
    expect(src).toContain("return 25 * 60_000;");
    const crb = readFileSync(new URL("../../client/src/lib/canvasRunBlock.ts", import.meta.url), "utf8");
    expect(crb).toContain("CANVAS_GPT_IMAGE2_POLL_MAX_MS = 13 * 60_000");
    const evo = readFileSync(new URL("./evolinkGptImage2.ts", import.meta.url), "utf8");
    expect(evo).toContain("throw new SubmitUnknownError(`EvoLink task poll timeout");
  });
});
