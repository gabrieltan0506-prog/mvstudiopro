import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __setKnowledgeCardDistillGatewayInvokerForTest,
  invokeDistillLlmPossiblyChunked,
  knowledgeCardDistillProfile,
} from "./knowledgeCardDistill";
import { KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK } from "../../shared/knowledgeCardDistillModels";

afterEach(() => {
  __setKnowledgeCardDistillGatewayInvokerForTest(null);
  vi.unstubAllEnvs();
});

// 只替换上游网关，分段、合并、统稿、校验和失败恢复均走正式函数。
describe("完整版恢复原保留规则", { timeout: 30_000 }, () => {
  async function run(collapse: boolean) {
    vi.stubEnv("EVOLINK_API_KEY", "test-key");
    vi.stubEnv("KNOWLEDGE_CARD_DISTILL_RETRY_BACKOFF_MS", "0");
    vi.stubEnv("KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS", "0");
    const inputs: string[] = [];
    let finalCalls = 0;
    __setKnowledgeCardDistillGatewayInvokerForTest(async p => {
      if (p.systemOverride) {
        finalCalls += 1;
        const sectionCount = (p.sourceText.match(/^##\s+/gm) || []).length;
        expect(p.minSections).toBe(sectionCount);
        expect(p.systemOverride).toContain(`总节数不少于 ${Math.floor(sectionCount * 0.9)} 个`);
        expect(p.systemOverride).toContain("数字、步骤、条件、例子一条不少");
        expect(p.systemOverride).toContain("独立解说、适用条件、注意与例外保留为独立普通段落");
        expect(p.systemOverride).not.toContain("先浓缩再编排");
        inputs.push(p.sourceText);
        return collapse ? `# 总结\n\n## 唯一小节\n${"已经遗漏原章节的长总结。".repeat(50)}` : p.sourceText;
      }
      return `# 总标题\n\n${Array.from({ length: 8 }, (_, i) => `## ${p.chunkLabel}-${i}\n数字${i + 1}、操作步骤和适用条件必须保留。${"具体知识与边界。".repeat(8)}`).join("\n\n")}`;
    });
    const profile = knowledgeCardDistillProfile(KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK);
    const out = await invokeDistillLlmPossiblyChunked({
      sourceText: "原文知识。".repeat(Math.ceil((profile.chunkThreshold + 100) / 5)),
      extraText: "", imageUrls: [], documents: [],
      modelName: KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK,
      minSectionsTotal: 2, detailLevel: "full",
    });
    expect(finalCalls).toBeGreaterThan(0);
    expect(inputs.length).toBeGreaterThan(0);
    expect(out).toBe(inputs[0]);
    expect((out.match(/^##\s+/gm) || []).length).toBeGreaterThan(8);
    expect(out).not.toContain("唯一小节");
  }

  it("全稿统稿保留原章节并以输入节数作为目标", async () => run(false));
  it("即使返回长正文，塌缩为一节也必须拒绝并保留原稿", async () => run(true));
});
