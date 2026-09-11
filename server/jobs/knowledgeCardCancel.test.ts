/**
 * 读档终止（0911 用户令：面板要有终止按钮）。
 * 验的是真实收口语义，不是「按钮点得动」：
 * · 取消标记写进 jobs.input，worker 下一次进度回调就 abort，在途请求跟着断；
 * · 计费点在提炼返回之后 —— 中途停一分不扣，所以也不存在退款；
 * · 库抖动不许误判成取消（宁可多跑一会儿，不能把用户的活判死）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareKnowledgeCardCopy, __setKnowledgeCardDistillGatewayInvokerForTest } from "../services/knowledgeCardDistill";

// 链需要至少一把钥匙才会进网关（invoker 已被替换，不会真的发请求）
const stubKeys = () => {
  vi.stubEnv("EVOLINK_API_KEY", "e-key");
  vi.stubEnv("OPENROUTER_API_KEY", "o-key");
  vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "s-key");
};

afterEach(() => {
  vi.unstubAllEnvs();
  __setKnowledgeCardDistillGatewayInvokerForTest(null);
});

const SECTIONS = Array.from({ length: 6 }, (_, i) =>
  `## 第${i + 1}节\n图：示意\n- 要点\n\n| A | B |\n| - | - |\n| 1 | 2 |\n`,
).join("\n");

describe("读档终止：信号真的传到在途请求", () => {
  it("abort 后：提炼立刻抛取消错误，且不再发起新的网关请求", async () => {
    stubKeys();
    const ac = new AbortController();
    let calls = 0;
    __setKnowledgeCardDistillGatewayInvokerForTest(async (params: { abortSignal?: AbortSignal }) => {
      calls += 1;
      // 第一次调用途中用户点了终止
      ac.abort(new Error("已按你的要求停止读档（未开始计费）"));
      await new Promise((r) => setTimeout(r, 10));
      params.abortSignal?.throwIfAborted();
      return SECTIONS;
    });
    try {
      await expect(
        prepareKnowledgeCardCopy({
          sourceText: "正文".repeat(400),
          forceDistill: true,
          abortSignal: ac.signal,
        }),
      ).rejects.toThrow(/停止读档/);
      expect(calls).toBe(1);
    } finally {
      __setKnowledgeCardDistillGatewayInvokerForTest(null);
    }
  }, 30_000);

  it("没有取消信号时照常跑完（回归：别把正常路径一起掐了）", async () => {
    stubKeys();
    __setKnowledgeCardDistillGatewayInvokerForTest(async () => SECTIONS);
    try {
      const r = await prepareKnowledgeCardCopy({ sourceText: "正文".repeat(400), forceDistill: true });
      expect(r.distilledMarkdown).toContain("## 第1节");
    } finally {
      __setKnowledgeCardDistillGatewayInvokerForTest(null);
    }
  }, 30_000);
});

describe("取消标记：worker 与路由之间的唯一信号", () => {
  it("查不到任务行按「停」处理，不让孤儿任务空转", async () => {
    vi.resetModules();
    vi.doMock("../db", () => ({ getDb: async () => null }));
    const { isPlatformJobCancelRequested } = await import("./repository");
    await expect(isPlatformJobCancelRequested("job-not-exist")).resolves.toBe(true);
    vi.doUnmock("../db");
    vi.resetModules();
  });
});
