import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_IMAGE_CHANNEL_MAX, knowledgeFinalRevisionChannel, knowledgeLayoutBatchChannel,
  KNOWLEDGE_MODEL_CHANNEL_MAX,
  KnowledgeRateGate,
  isKnowledgeRateLimited,
  knowledgeChannelLanes,
  knowledgeStageConcurrency,
  runKnowledgeStaggeredPool,
} from "./knowledgeConcurrency";

describe("动态并发：clamp(ceil(n/轮数), 下限, 上限)", () => {
  it("小文件低并发、大文件高并发，受上限约束", () => {
    expect(knowledgeStageConcurrency(0, { max: 16 })).toBe(0);
    expect(knowledgeStageConcurrency(3, { max: 16 })).toBe(3);
    expect(knowledgeStageConcurrency(16, { max: 32 })).toBe(16);
    expect(knowledgeStageConcurrency(100, { max: 32 })).toBe(32);
    expect(knowledgeStageConcurrency(100, { max: 32, targetRounds: 4 })).toBe(25);
    expect(knowledgeStageConcurrency(5, { max: 32, min: 10 })).toBe(5);
  });
  it("双通道分摊：OpenRouter 份额更大、交错排列、各不超上限", () => {
    const lanes = knowledgeChannelLanes(16, KNOWLEDGE_MODEL_CHANNEL_MAX, ["openrouter", "evolink"]);
    expect(lanes).toHaveLength(16);
    const or = lanes.filter(l => l === "openrouter").length;
    expect(or).toBeGreaterThan(16 - or);
    expect(lanes.slice(0, 2)).toEqual(["openrouter", "evolink"]);
    const big = knowledgeChannelLanes(200, KNOWLEDGE_MODEL_CHANNEL_MAX, ["openrouter", "evolink"]);
    expect(big.filter(l => l === "openrouter")).toHaveLength(16);
    expect(big.filter(l => l === "evolink")).toHaveLength(16);
    expect(knowledgeChannelLanes(1, KNOWLEDGE_MODEL_CHANNEL_MAX, ["openrouter", "evolink"])).toEqual(["openrouter"]);
    expect(knowledgeChannelLanes(2, KNOWLEDGE_MODEL_CHANNEL_MAX, ["openrouter", "evolink"]).sort()).toEqual(["evolink", "openrouter"]);
  });
  it("16 张图一次发完，官方与 EvoLink 分摊", () => {
    const lanes = knowledgeChannelLanes(16, KNOWLEDGE_IMAGE_CHANNEL_MAX, ["openai", "evolink"], 0.5);
    expect(lanes).toHaveLength(16);
    expect(lanes.filter(l => l === "openai")).toHaveLength(8);
  });
});

describe("限流退避与错峰池", () => {
  it("识别 429/keyLimit/额度类信号，普通错误不算", () => {
    expect(isKnowledgeRateLimited(new Error("HTTP 429 Too Many Requests"))).toBe(true);
    expect(isKnowledgeRateLimited(new Error("keyLimit reached"))).toBe(true);
    expect(isKnowledgeRateLimited(new Error("输出合同不符"))).toBe(false);
  });
  it("闸门遇限流减半，成功后逐步回升", async () => {
    const gate = new KnowledgeRateGate(8);
    await gate.acquire(); gate.release("rate_limited");
    expect(gate.limit).toBe(4);
    await gate.acquire(); gate.release("rate_limited");
    expect(gate.limit).toBe(2);
    await gate.acquire(); gate.release("ok");
    expect(gate.limit).toBe(3);
    expect(gate.rateLimited).toBe(2);
  });
  it("池：全部任务一轮在途、同通道错峰首发、错误收集不重试、限流后该通道并发下降", async () => {
    let inFlight = 0, peak = 0;
    const calls: number[] = [];
    const sleeps: number[] = [];
    const gate = new KnowledgeRateGate(4);
    const { results, errors } = await runKnowledgeStaggeredPool([0, 1, 2, 3, 4, 5, 6, 7], {
      lanes: ["a", "b", "a", "b"] as const,
      gates: { a: gate },
      sleep: async ms => { sleeps.push(ms); },
      worker: async (item, _i, channel) => {
        calls.push(item);
        inFlight++; peak = Math.max(peak, inFlight);
        await new Promise(r => setTimeout(r, 5));
        inFlight--;
        if (item === 2 && channel === "a") throw new Error("429 rate limit");
        if (item === 5) throw new Error("合同不符");
        return item * 10;
      },
    });
    expect(calls.sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(4);
    expect(sleeps).toEqual([400, 400]);
    expect(errors.map(e => e.index).sort()).toEqual(errors.some(e => e.index === 2) ? [2, 5] : [5]);
    expect(results[7]).toBe(70);
  });
});

it("统稿与整册排版同位首发通道错开，两步各自仍两通道交替铺满", () => {
  for (let i = 0; i < 34; i++) expect(knowledgeFinalRevisionChannel(i)).not.toBe(knowledgeLayoutBatchChannel(i));
  expect(knowledgeFinalRevisionChannel(0)).toBe("evolink");
  const count = (f: (i: number) => string) => Array.from({ length: 34 }, (_, i) => f(i)).filter(c => c === "evolink").length;
  expect(count(knowledgeFinalRevisionChannel)).toBe(17);
  expect(count(knowledgeLayoutBatchChannel)).toBe(17);
});
