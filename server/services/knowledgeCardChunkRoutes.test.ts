import { afterEach, expect, it, vi } from "vitest";
import {
  __setKnowledgeCardDistillGatewayInvokerForTest, invokeDistillLlmPossiblyChunked,
  KNOWLEDGE_CARD_CHUNK_WORKERS_PER_ROUTE, KNOWLEDGE_CARD_ROUTE_STAGGER_MS,
} from "./knowledgeCardDistill";
import { knowledgeCardChainForPrimary, KNOWLEDGE_CARD_GLM_FIRST_ORDER } from "./knowledgeCardGatewayOrder";
import { KNOWLEDGE_CARD_DISTILL_MODEL_GLM } from "../../shared/knowledgeCardDistillModels";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); __setKnowledgeCardDistillGatewayInvokerForTest(null); });

it("同模型跨路由后才换第二模型", () => {
  const labels = (primary: "openrouter" | "evolink") => knowledgeCardChainForPrimary(KNOWLEDGE_CARD_GLM_FIRST_ORDER, primary).map(s => `${s.gateway}:${s.tier}`);
  expect(labels("openrouter")).toEqual(["openrouter:glm", "evolink:glm", "openrouter:deepseek", "evolink:deepseek"]);
  expect(labels("evolink")).toEqual(["evolink:glm", "openrouter:glm", "evolink:deepseek", "openrouter:deepseek"]);
});

it("两路各五个工位错峰启动，完成一份即补位；121 张图片无遗漏重复，总并发不超过十", async () => {
  vi.useFakeTimers();
  vi.stubEnv("OPENROUTER_API_KEY", "test-or"); vi.stubEnv("EVOLINK_API_KEY", "test-evo");
  const urls = Array.from({ length: 121 }, (_, i) => `https://example.invalid/image-${i}.png`);
  const calls: Array<{ url: string; gateway: string }> = [];
  const pending: Array<() => void> = [];
  let active = 0, peak = 0;
  __setKnowledgeCardDistillGatewayInvokerForTest(async p => {
    if (!p.imageUrls.length) return p.sourceText;
    expect(p.imageUrls).toHaveLength(1);
    calls.push({ url: p.imageUrls[0], gateway: p.gateway });
    active++; peak = Math.max(peak, active);
    await new Promise<void>(resolve => pending.push(resolve)); active--;
    return `## 图片 ${p.imageUrls[0]}\n- 完整保留图片中的文字和图表要点用于最终统稿。\n- 本条为测试内容，未调用真实模型。`;
  });
  const result = invokeDistillLlmPossiblyChunked({ sourceText: "", extraText: "", imageUrls: urls, documents: [],
    modelName: KNOWLEDGE_CARD_DISTILL_MODEL_GLM, minSectionsTotal: 12, detailLevel: "full" });
  await vi.advanceTimersByTimeAsync(0);
  expect(calls).toHaveLength(5);
  expect(calls.every(c => c.gateway === "openrouter")).toBe(true);
  pending.shift()!(); await vi.advanceTimersByTimeAsync(0);
  expect(calls).toHaveLength(6);
  await vi.advanceTimersByTimeAsync(KNOWLEDGE_CARD_ROUTE_STAGGER_MS - 1);
  expect(calls.some(c => c.gateway === "evolink")).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls.filter(c => c.gateway === "evolink")).toHaveLength(5);
  while (pending.length) { pending.splice(0).forEach(resolve => resolve()); await vi.advanceTimersByTimeAsync(0); }
  expect((await result).length).toBeGreaterThan(0);
  expect(calls.map(c => c.url)).toEqual(urls);
  expect(peak).toBe(10);
  expect(KNOWLEDGE_CARD_CHUNK_WORKERS_PER_ROUTE).toBe(5);
  expect(KNOWLEDGE_CARD_ROUTE_STAGGER_MS).toBe(3500);
});
