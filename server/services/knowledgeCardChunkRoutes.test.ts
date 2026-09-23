/**
 * 0923 用户令：分段提炼「3 段给 OpenRouter、3 段给 EvoLink」，快的那条路多做。
 * 验：两条路都在用、每条路同时最多 3 段、合计最多 6 段、快路做得多、EvoLink 路链序为同档 EvoLink 先。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __setKnowledgeCardDistillGatewayInvokerForTest,
  invokeDistillLlmPossiblyChunked,
  KNOWLEDGE_CARD_CHUNK_WORKERS_PER_ROUTE,
} from "./knowledgeCardDistill";
import { evolinkFirstChain, KNOWLEDGE_CARD_GLM_FIRST_ORDER, KNOWLEDGE_CARD_DEEPSEEK_FIRST_ORDER } from "./knowledgeCardGatewayOrder";
import { KNOWLEDGE_CARD_DISTILL_MODEL_GLM } from "../../shared/knowledgeCardDistillModels";

afterEach(() => {
  vi.unstubAllEnvs();
  __setKnowledgeCardDistillGatewayInvokerForTest(null);
  vi.restoreAllMocks();
});

const label = (s: { gateway: string; tier: string }) => `${s.gateway}:${s.tier}`;

describe("EvoLink 路链序", () => {
  it("同档内 EvoLink 先、OpenRouter 后；档之间顺序不变；千问两跳原样", () => {
    expect(evolinkFirstChain(KNOWLEDGE_CARD_GLM_FIRST_ORDER).map(label)).toEqual([
      "evolink:glm", "openrouter:glm", "evolink:deepseek", "openrouter:deepseek", "dashscope_sg:qwen", "openrouter:qwen",
    ]);
    expect(evolinkFirstChain(KNOWLEDGE_CARD_DEEPSEEK_FIRST_ORDER).map(label)).toEqual([
      "evolink:deepseek", "openrouter:deepseek", "evolink:glm", "openrouter:glm", "dashscope_sg:qwen", "openrouter:qwen",
    ]);
  });
});

describe("分段提炼双路由工位", () => {
  it("两条路各 3 工位：每路同时 ≤3、合计 ≤6；快路（OpenRouter）做得多", async () => {
    vi.stubEnv("EVOLINK_API_KEY", "e");
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "s");
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    vi.stubEnv("KNOWLEDGE_CARD_DISTILL_RETRY_BACKOFF_MS", "0");
    vi.stubEnv("KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS", "0");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});

    const active: Record<string, number> = { openrouter: 0, evolink: 0 };
    const maxActive: Record<string, number> = { openrouter: 0, evolink: 0 };
    let maxTotal = 0;
    const firstHopByChunk = new Map<string, string>();
    __setKnowledgeCardDistillGatewayInvokerForTest(async (p) => {
      const isChunk = /段（/.test(String(p.chunkLabel || ""));
      if (isChunk && !firstHopByChunk.has(p.chunkLabel!)) firstHopByChunk.set(p.chunkLabel!, p.gateway);
      active[p.gateway] = (active[p.gateway] || 0) + 1;
      maxActive[p.gateway] = Math.max(maxActive[p.gateway] || 0, active[p.gateway]!);
      maxTotal = Math.max(maxTotal, (active.openrouter || 0) + (active.evolink || 0));
      // OpenRouter 快、EvoLink 慢
      await new Promise((r) => setTimeout(r, p.gateway === "openrouter" ? 5 : 40));
      active[p.gateway]! -= 1;
      return `## 第${Math.random().toString(36).slice(2, 6)}节\n\n- 要点一条内容足够长\n- 要点二条内容足够长\n- 要点三条内容足够长`;
    });

    // 20 段：每段约 2.4 万字（段落边界切）
    const para = "这是正文段落，用来凑够分段长度。".repeat(60);
    const text = Array.from({ length: 20 * 25 }, () => para).join("\n\n");
    await invokeDistillLlmPossiblyChunked({
      sourceText: text,
      extraText: "",
      imageUrls: [],
      documents: [],
      modelName: KNOWLEDGE_CARD_DISTILL_MODEL_GLM,
      minSectionsTotal: 20,
      detailLevel: "full",
    });

    const firstHops = Array.from(firstHopByChunk.values());
    expect(firstHops.length).toBeGreaterThanOrEqual(12);
    const orCount = firstHops.filter((g) => g === "openrouter").length;
    const evoCount = firstHops.filter((g) => g === "evolink").length;
    expect(evoCount).toBeGreaterThan(0);
    // 快的那条路做得多（不再整波等最慢那段）
    expect(orCount).toBeGreaterThan(evoCount);
    expect(maxActive.openrouter).toBeLessThanOrEqual(KNOWLEDGE_CARD_CHUNK_WORKERS_PER_ROUTE);
    expect(maxActive.evolink).toBeLessThanOrEqual(KNOWLEDGE_CARD_CHUNK_WORKERS_PER_ROUTE);
    expect(maxTotal).toBeGreaterThan(KNOWLEDGE_CARD_CHUNK_WORKERS_PER_ROUTE);
    expect(maxTotal).toBeLessThanOrEqual(2 * KNOWLEDGE_CARD_CHUNK_WORKERS_PER_ROUTE);
    expect(KNOWLEDGE_CARD_CHUNK_WORKERS_PER_ROUTE).toBe(3);
  });
});
