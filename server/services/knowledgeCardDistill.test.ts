import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_CARD_DISTILL_MODEL,
  mergeDistilledMarkdownChunks,
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
    expect(suggestKnowledgeCardMinSections(50_000)).toBeGreaterThanOrEqual(20);
    expect(suggestKnowledgeCardMinSections(120_000)).toBe(80);
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
