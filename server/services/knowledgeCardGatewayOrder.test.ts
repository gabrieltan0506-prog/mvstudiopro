/**
 * 读档链回归（0911 用户令）：三条链（主提炼 / 挑页 / 派生）消费**同一份**顺序定义；
 * 读档二选一（DeepSeek V4.1 Flash / GLM 5.3 Flash），选中的那档两家供应商先跑完，
 * 再换另一档两家，Qwen3.8 Max 永远最后；OpenRouter 的 DeepSeek / GLM 跳各锁各的自营。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KNOWLEDGE_CARD_DEEPSEEK_FIRST_ORDER,
  KNOWLEDGE_CARD_GLM_FIRST_ORDER,
  KNOWLEDGE_CARD_PREMIUM_FALLBACK_TAIL,
  filterConfiguredSteps,
  openRouterProviderLockForTier,
  type KnowledgeCardGatewayStep,
} from "./knowledgeCardGatewayOrder";
import {
  __setKnowledgeCardDistillGatewayInvokerForTest,
  distillGatewayChain,
  makeKnowledgeCardPageSelector,
} from "./knowledgeCardDistill";
import { pageTriageTestHooks } from "./knowledgeCardPageTriage";
import {
  KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK,
  KNOWLEDGE_CARD_DISTILL_MODEL_GLM,
} from "../../shared/knowledgeCardDistillModels";

afterEach(() => {
  vi.unstubAllEnvs();
  __setKnowledgeCardDistillGatewayInvokerForTest(null);
});

const ALL = { evolink: true, dashscope_sg: true, openrouter: true };
const label = (s: KnowledgeCardGatewayStep) => `${s.gateway}:${s.tier}`;
const allKeys = () => {
  vi.stubEnv("EVOLINK_API_KEY", "e");
  vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "s");
  vi.stubEnv("OPENROUTER_API_KEY", "o");
};

describe("唯一顺序定义", () => {
  it("两条链各六跳：选中档两家 → 另一档两家 → Qwen 两家；同一家网关多次出现不去重", () => {
    // 0911 用户令：同模型 OpenRouter 先、EvoLink 兜底；Qwen 例外（新加坡是预付套餐，排在前面）
    expect(KNOWLEDGE_CARD_DEEPSEEK_FIRST_ORDER.map(label)).toEqual([
      "openrouter:deepseek",
      "evolink:deepseek",
      "openrouter:glm",
      "evolink:glm",
      "dashscope_sg:qwen",
      "openrouter:qwen",
    ]);
    expect(KNOWLEDGE_CARD_GLM_FIRST_ORDER.map(label)).toEqual([
      "openrouter:glm",
      "evolink:glm",
      "openrouter:deepseek",
      "evolink:deepseek",
      "dashscope_sg:qwen",
      "openrouter:qwen",
    ]);
    // Qwen 永远最后两跳，任何一条链都不许把它提前
    for (const order of [KNOWLEDGE_CARD_DEEPSEEK_FIRST_ORDER, KNOWLEDGE_CARD_GLM_FIRST_ORDER]) {
      expect(order.slice(-2).map((s) => s.tier)).toEqual(["qwen", "qwen"]);
      expect(order.slice(0, -2).some((s) => s.tier === "qwen")).toBe(false);
    }
  });

  it("选 DeepSeek 的降档尾段就是本链去掉 DeepSeek 两跳的部分，不自造新跳（选 GLM 时直接走整条 GLM 链）", () => {
    expect(KNOWLEDGE_CARD_PREMIUM_FALLBACK_TAIL.map(label)).toEqual([
      "openrouter:glm",
      "evolink:glm",
      "dashscope_sg:qwen",
      "openrouter:qwen",
    ]);
    // 只配了 OpenRouter 钥匙时，三档各留一跳、顺序不变
    expect(filterConfiguredSteps(KNOWLEDGE_CARD_DEEPSEEK_FIRST_ORDER, { evolink: false, dashscope_sg: false, openrouter: true }).map((s) => s.tier)).toEqual([
      "deepseek",
      "glm",
      "qwen",
    ]);
  });

  it("OpenRouter provider 锁：DeepSeek 跳锁 DeepSeek、GLM 跳锁 Z.AI、Qwen 跳不锁", () => {
    expect(openRouterProviderLockForTier("deepseek")).toEqual({ order: ["DeepSeek"], allow_fallbacks: false });
    expect(openRouterProviderLockForTier("glm")).toEqual({ order: ["Z.AI"], allow_fallbacks: false, require_parameters: true });
    expect(openRouterProviderLockForTier("qwen")).toBeNull();
  });

  it("主提炼链就是共享顺序按钥匙过滤的结果", () => {
    allKeys();
    expect(distillGatewayChain(KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK)).toEqual(filterConfiguredSteps(KNOWLEDGE_CARD_DEEPSEEK_FIRST_ORDER, ALL));
    expect(distillGatewayChain(KNOWLEDGE_CARD_DISTILL_MODEL_GLM)).toEqual(filterConfiguredSteps(KNOWLEDGE_CARD_GLM_FIRST_ORDER, ALL));
  });
});

const SHEET = [{ index: 1, pageNumbers: [1, 2, 3], imageUrl: "https://signed/s1.jpg", gcsUri: "gs://b/s1.jpg" }];

describe("挑页按所选档位走同一份顺序", () => {
  it("选 GLM：不打 DeepSeek 视觉专链，直接从 OpenRouter GLM 起跳", async () => {
    allKeys();
    const visionCalls: string[] = [];
    const hops: string[] = [];
    __setKnowledgeCardDistillGatewayInvokerForTest(async (p) => {
      hops.push(`${p.gateway}:${p.tier ?? "?"}`);
      return '{"pages":[{"page":2,"reason":"表格"}]}';
    });
    const picked = await pageTriageTestHooks.run(
      { chat: (async (gw: { name: string }) => { visionCalls.push(gw.name); throw new Error("不该走视觉跳"); }) as never },
      () => makeKnowledgeCardPageSelector(KNOWLEDGE_CARD_DISTILL_MODEL_GLM)(SHEET as never, 3),
    );
    expect(visionCalls).toEqual([]);
    expect(hops).toEqual(["openrouter:glm"]);
    expect(picked).toEqual([{ pageNumber: 2, reason: "表格" }]);
  });

  it("选 DeepSeek：两家 DeepSeek 视觉都挂 → 降档尾段从 OpenRouter GLM 起跳，坏 JSON 跳内判失败换下一跳", async () => {
    allKeys();
    const hops: string[] = [];
    __setKnowledgeCardDistillGatewayInvokerForTest(async (p) => {
      hops.push(`${p.gateway}:${p.tier ?? "?"}`);
      if (p.gateway === "openrouter") return "抱歉，我看不清这些图片";
      return '{"pages":[{"page":3,"reason":"图解"}]}';
    });
    const picked = await pageTriageTestHooks.run(
      { chat: (async () => { throw new Error("vision down"); }) as never },
      () => makeKnowledgeCardPageSelector(KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK)(SHEET as never, 3),
    );
    expect(hops).toEqual(["openrouter:glm", "evolink:glm"]);
    expect(picked).toEqual([{ pageNumber: 3, reason: "图解" }]);
  });

  it("合法空表 {\"pages\":[]} 是成功：不套 20 字下限、不再换跳", async () => {
    allKeys();
    const hops: string[] = [];
    __setKnowledgeCardDistillGatewayInvokerForTest(async (p) => {
      hops.push(p.gateway);
      return '{"pages":[]}';
    });
    const picked = await pageTriageTestHooks.run(
      { chat: (async () => { throw new Error("vision down"); }) as never },
      () => makeKnowledgeCardPageSelector(KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK)(SHEET as never, 3),
    );
    expect(hops).toEqual(["openrouter"]);
    expect(picked).toEqual([]);
  });
});

describe("派生链按 receipt 档位走同一份顺序", () => {
  it("GLM receipt 从 EvoLink GLM 起跳；DeepSeek receipt 从 EvoLink DeepSeek 起跳；两者末跳都是 OpenRouter Qwen", async () => {
    allKeys();
    vi.resetModules();
    const mod = await import("./knowledgeCardLevelDerive");
    const build = (mod as unknown as {
      __testDeriveGateways?: (m?: string) => Array<{ name: string; tier: string; model: string }>;
    }).__testDeriveGateways;
    if (!build) {
      expect.fail("缺少 __testDeriveGateways 导出");
      return;
    }
    const glm = build(KNOWLEDGE_CARD_DISTILL_MODEL_GLM);
    expect(glm.map((g) => `${g.name}:${g.tier}`)).toEqual(KNOWLEDGE_CARD_GLM_FIRST_ORDER.map(label));
    expect(glm[0]).toMatchObject({ name: "openrouter", model: "z-ai/glm-5.3-flash" });
    expect(glm[1]).toMatchObject({ name: "evolink", model: "glm-5.3-flash" });

    const deepseek = build(KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK);
    expect(deepseek.map((g) => `${g.name}:${g.tier}`)).toEqual(KNOWLEDGE_CARD_DEEPSEEK_FIRST_ORDER.map(label));
    expect(deepseek[0]).toMatchObject({ name: "openrouter", model: "deepseek/deepseek-v4.1-flash" });
    expect(deepseek[1]).toMatchObject({ name: "evolink", model: "deepseek-v4-flash-vision-exp" });
    expect(deepseek[deepseek.length - 1]).toMatchObject({ name: "openrouter", model: "qwen/qwen3.8-max" });

    // 历史 receipt 里的旧档位值（Qwen 轻量档 / DeepSeek V4）也要迁到现行两档，不掉回旧链
    expect(build("qwen3.8-max").map((g) => `${g.name}:${g.tier}`)).toEqual(KNOWLEDGE_CARD_GLM_FIRST_ORDER.map(label));
    expect(build("deepseek-v4-flash").map((g) => `${g.name}:${g.tier}`)).toEqual(KNOWLEDGE_CARD_DEEPSEEK_FIRST_ORDER.map(label));
  });
});
