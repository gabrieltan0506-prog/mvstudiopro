import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_CARD_DISTILL_MODEL_QWEN,
  KNOWLEDGE_CARD_DISTILL_MODEL_SOL,
  knowledgeCardDistillFeeForModel,
} from "./knowledgeCardDistillModels";
import { estimateKnowledgeCardDistillTradeoff } from "./knowledgeCardPagination";
import { suggestKnowledgeCardMinSections } from "./knowledgeCardDistillSections";

function tradeoffFor(chars: number, model: string) {
  return estimateKnowledgeCardDistillTradeoff(
    "字".repeat(chars),
    model,
    suggestKnowledgeCardMinSections,
    knowledgeCardDistillFeeForModel(model),
  );
}

describe("estimateKnowledgeCardDistillTradeoff", () => {
  /** 弹窗要靠这个数字说服用户掏提炼费，算错就是砸招牌 */
  it("一万字：提炼把 9 页压到 4 页，扣掉提炼费仍净省", () => {
    const t = tradeoffFor(10_000, KNOWLEDGE_CARD_DISTILL_MODEL_SOL);
    expect(t.full.pages).toBe(9);
    expect(t.full.credits).toBe(264); // 8×30 + 1×24
    expect(t.distilled.pages).toBe(4);
    expect(t.distilled.credits).toBe(120);
    expect(t.distilled.distillFee).toBe(50);
    expect(t.saved).toBe(94);
  });

  it("超过 6 页会被降到 2K，提炼后能保住 4K", () => {
    const t = tradeoffFor(10_000, KNOWLEDGE_CARD_DISTILL_MODEL_SOL);
    expect(t.full.is4k).toBe(false);
    expect(t.distilled.is4k).toBe(true);
  });

  it("两万字省得更多", () => {
    const t = tradeoffFor(20_000, KNOWLEDGE_CARD_DISTILL_MODEL_SOL);
    expect(t.full.pages).toBeGreaterThan(15);
    expect(t.saved).toBeGreaterThan(250);
  });

  it("轻量档提炼费更低，省得更多", () => {
    const sol = tradeoffFor(20_000, KNOWLEDGE_CARD_DISTILL_MODEL_SOL);
    const qwen = tradeoffFor(20_000, KNOWLEDGE_CARD_DISTILL_MODEL_QWEN);
    expect(qwen.distilled.distillFee).toBe(30);
    expect(sol.distilled.distillFee).toBe(50);
  });

  /** 短文提炼不划算，弹窗不该在这种时候劝人花钱 */
  it("四千字上下省不了多少，甚至可能倒贴", () => {
    const t = tradeoffFor(4_000, KNOWLEDGE_CARD_DISTILL_MODEL_SOL);
    expect(t.saved).toBeLessThan(50);
  });
});
