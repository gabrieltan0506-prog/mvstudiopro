/**
 * 终审第五条回归：三条链（主提炼 / 挑页 / 派生）消费**同一份**顺序定义；
 * 轻量挑页不从 DeepSeek 起跳；精细挑页降档尾段不多出第 5 跳；
 * 新加坡坏 JSON 在跳内判失败 → OpenRouter Qwen 接住整组参考页。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KNOWLEDGE_CARD_LIGHT_ORDER,
  KNOWLEDGE_CARD_PREMIUM_ORDER,
  KNOWLEDGE_CARD_PREMIUM_QWEN_TAIL,
  filterConfiguredSteps,
} from "./knowledgeCardGatewayOrder";
import {
  __setKnowledgeCardDistillGatewayInvokerForTest,
  distillGatewayChain,
  makeKnowledgeCardPageSelector,
} from "./knowledgeCardDistill";
import { pageTriageTestHooks } from "./knowledgeCardPageTriage";
import {
  KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK,
  KNOWLEDGE_CARD_DISTILL_MODEL_QWEN,
} from "../../shared/knowledgeCardDistillModels";

afterEach(() => {
  vi.unstubAllEnvs();
  __setKnowledgeCardDistillGatewayInvokerForTest(null);
});

const ALL = { evolink: true, dashscope_sg: true, openrouter: true };

describe("唯一顺序定义", () => {
  it("精细四跳 / 轻量三跳；OpenRouter 两跳不按供应商名去重；尾段等于精细序里的 Qwen 跳", () => {
    expect(KNOWLEDGE_CARD_PREMIUM_ORDER.map((s) => `${s.gateway}:${s.tier}`)).toEqual([
      "evolink:deepseek",
      "openrouter:deepseek",
      "dashscope_sg:qwen",
      "openrouter:qwen",
    ]);
    expect(KNOWLEDGE_CARD_LIGHT_ORDER.map((s) => `${s.gateway}:${s.tier}`)).toEqual([
      "dashscope_sg:qwen",
      "openrouter:qwen",
      "evolink:qwen",
    ]);
    expect(KNOWLEDGE_CARD_PREMIUM_QWEN_TAIL.map((s) => `${s.gateway}:${s.tier}`)).toEqual([
      "dashscope_sg:qwen",
      "openrouter:qwen",
    ]);
    expect(filterConfiguredSteps(KNOWLEDGE_CARD_PREMIUM_ORDER, { evolink: false, dashscope_sg: false, openrouter: true }).map((s) => s.tier)).toEqual([
      "deepseek",
      "qwen",
    ]);
  });

  it("主提炼链就是共享顺序按钥匙过滤的结果", () => {
    vi.stubEnv("EVOLINK_API_KEY", "e");
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "s");
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    expect(distillGatewayChain(KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK)).toEqual(filterConfiguredSteps(KNOWLEDGE_CARD_PREMIUM_ORDER, ALL));
    expect(distillGatewayChain(KNOWLEDGE_CARD_DISTILL_MODEL_QWEN)).toEqual(filterConfiguredSteps(KNOWLEDGE_CARD_LIGHT_ORDER, ALL));
  });
});

const SHEET = [{ index: 1, pageNumbers: [1, 2, 3], imageUrl: "https://signed/s1.jpg", gcsUri: "gs://b/s1.jpg" }];

describe("挑页按档位走同一份顺序", () => {
  it("轻量档：不打 DeepSeek 视觉，直接走轻量 Qwen 链（首跳新加坡）", async () => {
    vi.stubEnv("EVOLINK_API_KEY", "e");
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "s");
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    const visionCalls: string[] = [];
    const hops: string[] = [];
    __setKnowledgeCardDistillGatewayInvokerForTest(async (p) => {
      hops.push(`${p.gateway}:${p.tier ?? "?"}`);
      return '{"pages":[{"page":2,"reason":"表格"}]}';
    });
    const picked = await pageTriageTestHooks.run(
      { chat: (async (gw: { name: string }) => { visionCalls.push(gw.name); throw new Error("不该走视觉跳"); }) as never },
      () => makeKnowledgeCardPageSelector(KNOWLEDGE_CARD_DISTILL_MODEL_QWEN)(SHEET as never, 3),
    );
    expect(visionCalls).toEqual([]);
    expect(hops).toEqual(["dashscope_sg:qwen"]);
    expect(picked).toEqual([{ pageNumber: 2, reason: "表格" }]);
  });

  it("精细档：新加坡回坏 JSON 在跳内判失败 → OpenRouter Qwen 接住；不出现第 5 跳 EvoLink Qwen", async () => {
    vi.stubEnv("EVOLINK_API_KEY", "e");
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "s");
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    const hops: string[] = [];
    __setKnowledgeCardDistillGatewayInvokerForTest(async (p) => {
      hops.push(`${p.gateway}:${p.tier ?? "?"}`);
      if (p.gateway === "dashscope_sg") return "抱歉，我看不清这些图片";
      return '{"pages":[{"page":3,"reason":"图解"}]}';
    });
    const picked = await pageTriageTestHooks.run(
      { chat: (async () => { throw new Error("vision down"); }) as never },
      () => makeKnowledgeCardPageSelector(KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK)(SHEET as never, 3),
    );
    expect(hops).toEqual(["dashscope_sg:qwen", "openrouter:qwen"]);
    expect(picked).toEqual([{ pageNumber: 3, reason: "图解" }]);
  });

  it("合法空表 {\"pages\":[]} 是成功：不套 20 字下限、不再换跳", async () => {
    vi.stubEnv("EVOLINK_API_KEY", "e");
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "s");
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    const hops: string[] = [];
    __setKnowledgeCardDistillGatewayInvokerForTest(async (p) => {
      hops.push(p.gateway);
      return '{"pages":[]}';
    });
    const picked = await pageTriageTestHooks.run(
      { chat: (async () => { throw new Error("vision down"); }) as never },
      () => makeKnowledgeCardPageSelector(KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK)(SHEET as never, 3),
    );
    expect(hops).toEqual(["dashscope_sg"]);
    expect(picked).toEqual([]);
  });
});

describe("派生链按 receipt 档位走同一份顺序", () => {
  it("轻量 receipt：首跳新加坡 Qwen；精细 receipt：首跳 EvoLink DeepSeek、第四跳 OpenRouter Qwen", async () => {
    vi.stubEnv("EVOLINK_API_KEY", "e");
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "s");
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    vi.resetModules();
    const mod = await import("./knowledgeCardLevelDerive");
    const seen: Array<{ name: string; model: string }> = [];
    const fakeChat = (async (gw: { name: string; model: string }) => {
      seen.push({ name: gw.name, model: gw.model });
      throw new Error("stop");
    }) as never;
    // 通过 chat 注入观察网关序（deriveChat 内部构链）——直接调内部不可见，改走 compact 入口需长稿；
    // 这里用 deriveGateways 的行为出口：制造全部失败读 warn 序太绕，退而验证模块导出的链构造。
    const anyMod = mod as unknown as { __testDeriveGateways?: (m?: string) => Array<{ name: string; model: string }> };
    if (anyMod.__testDeriveGateways) {
      expect(anyMod.__testDeriveGateways("qwen3.8-max")[0]).toMatchObject({ name: "dashscope_sg" });
      const premium = anyMod.__testDeriveGateways("deepseek-v4-flash");
      expect(premium[0]).toMatchObject({ name: "evolink", model: "deepseek-v4-flash" });
      expect(premium[3]).toMatchObject({ name: "openrouter", model: "qwen/qwen3.8-max" });
    } else {
      expect.fail("缺少 __testDeriveGateways 导出");
    }
    void fakeChat;
    void seen;
  });
});
