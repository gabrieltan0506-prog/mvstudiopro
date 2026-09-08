import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_CARD_DISTILL_MODEL,
  estimateKnowledgeCardDistillChunks,
  knowledgeCardDistillProfile,
  mergeDistilledMarkdownChunks,
  shouldRunKnowledgeCardDistillAsync,
  splitSourceTextForDistill,
  suggestKnowledgeCardMinSections,
} from "./knowledgeCardDistill";
import {
  KNOWLEDGE_CARD_DISTILL_MODEL_KIMI,
  KNOWLEDGE_CARD_DISTILL_MODEL_QWEN,
  KNOWLEDGE_CARD_DISTILL_MODEL_QWEN_OR,
  KNOWLEDGE_CARD_DISTILL_MODEL_SOL,
  KNOWLEDGE_CARD_DISTILL_MODEL_TERRA,
  resolveKnowledgeCardDistillModel,
} from "../../shared/knowledgeCardDistillModels";

describe("knowledgeCardDistill model", () => {
  it("defaults to Evolink GPT-5.6 Sol", () => {
    expect(resolveKnowledgeCardDistillModel(undefined)).toBe(KNOWLEDGE_CARD_DISTILL_MODEL_SOL);
    expect(KNOWLEDGE_CARD_DISTILL_MODEL).toBe(KNOWLEDGE_CARD_DISTILL_MODEL_SOL);
  });

  it("accepts Kimi OR + Evolink Qwen; migrates legacy terra / OR-qwen", () => {
    expect(resolveKnowledgeCardDistillModel(KNOWLEDGE_CARD_DISTILL_MODEL_KIMI)).toBe(
      KNOWLEDGE_CARD_DISTILL_MODEL_KIMI,
    );
    expect(resolveKnowledgeCardDistillModel(KNOWLEDGE_CARD_DISTILL_MODEL_QWEN)).toBe(
      KNOWLEDGE_CARD_DISTILL_MODEL_QWEN,
    );
    expect(resolveKnowledgeCardDistillModel(KNOWLEDGE_CARD_DISTILL_MODEL_TERRA)).toBe(
      KNOWLEDGE_CARD_DISTILL_MODEL_SOL,
    );
    expect(resolveKnowledgeCardDistillModel(KNOWLEDGE_CARD_DISTILL_MODEL_QWEN_OR)).toBe(
      KNOWLEDGE_CARD_DISTILL_MODEL_QWEN,
    );
  });

  it("falls back on unknown id to Sol", () => {
    expect(resolveKnowledgeCardDistillModel("not-a-model")).toBe(KNOWLEDGE_CARD_DISTILL_MODEL_SOL);
  });
});

describe("suggestKnowledgeCardMinSections", () => {
  it("scales with source length so a book is not crushed to 1 section", () => {
    expect(suggestKnowledgeCardMinSections(100)).toBeLessThanOrEqual(2);
    expect(suggestKnowledgeCardMinSections(3000)).toBeGreaterThanOrEqual(4);
    expect(suggestKnowledgeCardMinSections(50_000)).toBeGreaterThanOrEqual(15);
  });

  // 用户 2026-08-05：提炼是取重点让人快速读懂，不是把 9.5 万字摊成几十页
  it("stays readable for a long book instead of growing linearly", () => {
    expect(suggestKnowledgeCardMinSections(10_000)).toBeLessThanOrEqual(12);
    // 9.5 万字：旧式线性会要 68 节；用户选定约 28 节（并页后约 5 张卡）
    const book = suggestKnowledgeCardMinSections(95_000);
    expect(book).toBeGreaterThanOrEqual(24);
    expect(book).toBeLessThanOrEqual(30);
    // 字数再翻几倍也只多几节，且封顶 36
    expect(suggestKnowledgeCardMinSections(300_000)).toBeLessThanOrEqual(36);
  });

  it("grows monotonically", () => {
    const lengths = [1_000, 5_000, 20_000, 60_000, 150_000];
    for (let i = 1; i < lengths.length; i += 1) {
      expect(suggestKnowledgeCardMinSections(lengths[i]!)).toBeGreaterThanOrEqual(
        suggestKnowledgeCardMinSections(lengths[i - 1]!),
      );
    }
  });
});

describe("splitSourceTextForDistill", () => {
  it("keeps short text as one chunk", () => {
    expect(splitSourceTextForDistill("短文")).toEqual(["短文"]);
  });

  it("splits long text into multiple chunks", () => {
    const body = "段落要点。\n\n".repeat(4000);
    const chunks = splitSourceTextForDistill(body, 10_000);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe("per-model distill profiles", () => {
  it("gives each model its own chunking + effort tuning", () => {
    const sol = knowledgeCardDistillProfile(KNOWLEDGE_CARD_DISTILL_MODEL_SOL);
    const kimi = knowledgeCardDistillProfile(KNOWLEDGE_CARD_DISTILL_MODEL_KIMI);
    const qwen = knowledgeCardDistillProfile(KNOWLEDGE_CARD_DISTILL_MODEL_QWEN);

    // Kimi 实测最快 → 段最大、并发最高；Qwen 最慢且压缩过度 → 段最小、最少小节最高
    expect(kimi.chunkChars).toBeGreaterThan(sol.chunkChars);
    expect(sol.chunkChars).toBeGreaterThan(qwen.chunkChars);
    expect(kimi.concurrency).toBeGreaterThanOrEqual(sol.concurrency);
    expect(qwen.minSectionsPerChunk).toBeGreaterThan(sol.minSectionsPerChunk);

    // 分段抽要点用中档，统稿抬档（各家枚举不同：Evolink 顶档 xhigh，OpenRouter 是 high|max）
    expect(sol.effortChunk).toBe("medium");
    expect(sol.effortFinal).toBe("xhigh");
    expect(qwen.effortChunk).toBe("medium");
    expect(qwen.effortFinal).toBe("xhigh");
    // Kimi 顶档 max 配长合并稿的统稿必超时（探针实测）→ 统稿用 high
    expect(kimi.effortFinal).toBe("high");

    for (const p of [sol, kimi, qwen]) {
      expect(p.chunkRetries).toBeGreaterThanOrEqual(1);
      expect(p.requestTimeoutMs).toBeGreaterThanOrEqual(60_000);
    }
  });

  it("routes only long books to the background job", () => {
    expect(shouldRunKnowledgeCardDistillAsync(5_000)).toBe(false);
    expect(shouldRunKnowledgeCardDistillAsync(25_000)).toBe(false);
    expect(shouldRunKnowledgeCardDistillAsync(95_000)).toBe(true);
  });

  it("estimates chunk count per model", () => {
    expect(estimateKnowledgeCardDistillChunks(KNOWLEDGE_CARD_DISTILL_MODEL_SOL, 3_000)).toBe(1);
    const solChunks = estimateKnowledgeCardDistillChunks(KNOWLEDGE_CARD_DISTILL_MODEL_SOL, 95_000);
    const kimiChunks = estimateKnowledgeCardDistillChunks(KNOWLEDGE_CARD_DISTILL_MODEL_KIMI, 95_000);
    const qwenChunks = estimateKnowledgeCardDistillChunks(KNOWLEDGE_CARD_DISTILL_MODEL_QWEN, 95_000);
    expect(kimiChunks).toBeLessThan(solChunks);
    expect(qwenChunks).toBeGreaterThan(solChunks);
  });
});

describe("mergeDistilledMarkdownChunks", () => {
  it("keeps first title and concatenates section bodies", () => {
    const merged = mergeDistilledMarkdownChunks([
      "# 总题\n\n## A\n- 1",
      "# 总题\n\n## B\n- 2",
      "## C\n- 3",
    ]);
    expect(merged.startsWith("# 总题")).toBe(true);
    expect(merged).toContain("## A");
    expect(merged).toContain("## B");
    expect(merged).toContain("## C");
    expect(merged.match(/^# /gm)?.length).toBe(1);
  });
});
