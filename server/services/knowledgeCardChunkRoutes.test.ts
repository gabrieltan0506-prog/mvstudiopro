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

it("两路各三个工位错峰启动（2026-11-14 减半），完成一份即补位；121 张图片无遗漏重复，总并发不超过六", async () => {
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
  const readChunks: number[]=[];
  const result = invokeDistillLlmPossiblyChunked({ onReadingPlan:async total=>{expect(total).toBe(121);},onReadingChunk:async chunk=>{expect(chunk.markdown).toContain("完整保留");readChunks.push(chunk.index);},sourceText: "", extraText: "", imageUrls: urls, documents: [],
    modelName: KNOWLEDGE_CARD_DISTILL_MODEL_GLM, minSectionsTotal: 12, detailLevel: "full" });
  await vi.advanceTimersByTimeAsync(0);
  expect(calls).toHaveLength(3);
  expect(calls.every(c => c.gateway === "openrouter")).toBe(true);
  pending.shift()!(); await vi.advanceTimersByTimeAsync(0);
  expect(calls).toHaveLength(4);
  await vi.advanceTimersByTimeAsync(KNOWLEDGE_CARD_ROUTE_STAGGER_MS - 1);
  expect(calls.some(c => c.gateway === "evolink")).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls.filter(c => c.gateway === "evolink")).toHaveLength(3);
  while (pending.length) { pending.splice(0).forEach(resolve => resolve()); await vi.advanceTimersByTimeAsync(0); }
  expect((await result).length).toBeGreaterThan(0);
  expect(calls.map(c => c.url)).toEqual(urls);
  expect(readChunks).toHaveLength(121);
  expect(new Set(readChunks).size).toBe(121);
  expect(peak).toBe(6);
  expect(KNOWLEDGE_CARD_CHUNK_WORKERS_PER_ROUTE).toBe(3);
  expect(KNOWLEDGE_CARD_ROUTE_STAGGER_MS).toBe(3500);
});

it("真实短文生产者先公布计划，再把完整结果交给同步顾问", async () => {
  vi.stubEnv("OPENROUTER_API_KEY","test-key");
  const events:string[]=[];
  const markdown="## 完整原文\n读档完成的完整知识和末句。";
  __setKnowledgeCardDistillGatewayInvokerForTest(async()=>{events.push("model");return markdown;});
  const result=await invokeDistillLlmPossiblyChunked({sourceText:"短原文",extraText:"",imageUrls:[],documents:[],modelName:KNOWLEDGE_CARD_DISTILL_MODEL_GLM,minSectionsTotal:1,detailLevel:"full",onReadingPlan:async total=>{expect(total).toBe(1);events.push("plan");},onReadingChunk:async chunk=>{expect(chunk).toEqual({index:0,total:1,markdown});events.push("chunk");}});
  expect(result).toBe(markdown);expect(events).toEqual(["plan","model","chunk"]);
});
