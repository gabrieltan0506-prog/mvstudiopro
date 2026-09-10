import { describe, expect, it, vi, afterEach } from "vitest";
import {
  KNOWLEDGE_CARD_ALL_CHUNKS_FAILED_MESSAGE,
  __setKnowledgeCardDistillGatewayInvokerForTest,
  invokeDistillLlmPossiblyChunked,
} from "./knowledgeCardDistill";
import { KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK } from "../../shared/knowledgeCardDistillModels";

afterEach(() => {
  __setKnowledgeCardDistillGatewayInvokerForTest(null);
  vi.unstubAllEnvs();
});

describe("全部分段失败不得产出「成稿」（审查 P1）", { timeout: 30_000 }, () => {
  it("每段都抛非致命错误 → 整本失败，不返回任何可出图的正文", async () => {
    vi.stubEnv("EVOLINK_API_KEY", "ev-key");
    vi.stubEnv("KNOWLEDGE_CARD_DISTILL_RETRY_BACKOFF_MS", "0");
    const notices: string[] = [];
    __setKnowledgeCardDistillGatewayInvokerForTest(async () => {
      throw new Error("模型返回格式异常：Unexpected token <");
    });
    const sourceText = "第一章 财务自由的起点。".repeat(4000);
    await expect(
      invokeDistillLlmPossiblyChunked({
        sourceText,
        extraText: "",
        imageUrls: [],
        documents: [],
        modelName: KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK,
        minSectionsTotal: 12,
        detailLevel: "full",
        onNotice: (n) => notices.push(n),
      }),
    ).rejects.toThrow(KNOWLEDGE_CARD_ALL_CHUNKS_FAILED_MESSAGE);
    expect(notices.length).toBeGreaterThan(0);
    expect(notices.join("\n")).not.toContain("部分提炼");
  });

  it("部分段失败：成稿只含成功段，并明确提醒是部分提炼", async () => {
    vi.stubEnv("EVOLINK_API_KEY", "ev-key");
    vi.stubEnv("KNOWLEDGE_CARD_DISTILL_RETRY_BACKOFF_MS", "0");
    const notices: string[] = [];
    __setKnowledgeCardDistillGatewayInvokerForTest(async (p) => {
      // 第 2 段（含其细切重试）恒失败，第 1 段与统稿正常
      if (String(p.chunkLabel || "").includes("第 2/")) throw new Error("模型返回格式异常");
      return "# 财务自由\n\n## 先建立现金缓冲\n- 留出六个月开支\n- 放在活期账户\n\n## 再谈投资比例\n- 先还高息负债\n- 剩余部分定投";
    });
    const sourceText = "第一章 财务自由的起点。".repeat(4000);
    const out = await invokeDistillLlmPossiblyChunked({
      sourceText,
      extraText: "",
      imageUrls: [],
      documents: [],
      modelName: KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK,
      minSectionsTotal: 12,
      detailLevel: "full",
      onNotice: (n) => notices.push(n),
    });
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out).not.toContain("未能提炼");
    expect(notices.join("\n")).toContain("部分提炼");
  });
});
