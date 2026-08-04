import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_CARD_DISTILL_MODEL,
  splitSourceTextForDistill,
  suggestKnowledgeCardMinSections,
} from "./knowledgeCardDistill";
import {
  KNOWLEDGE_CARD_DISTILL_MODEL_KIMI,
  KNOWLEDGE_CARD_DISTILL_MODEL_QWEN,
  resolveKnowledgeCardDistillModel,
} from "../../shared/knowledgeCardDistillModels";

describe("knowledgeCardDistill model", () => {
  it("defaults to OpenRouter Qwen3.8 Max", () => {
    expect(resolveKnowledgeCardDistillModel(undefined)).toBe(KNOWLEDGE_CARD_DISTILL_MODEL_QWEN);
    expect(KNOWLEDGE_CARD_DISTILL_MODEL).toBe(KNOWLEDGE_CARD_DISTILL_MODEL_QWEN);
  });

  it("accepts Kimi K3 for A/B trial", () => {
    expect(resolveKnowledgeCardDistillModel(KNOWLEDGE_CARD_DISTILL_MODEL_KIMI)).toBe(
      KNOWLEDGE_CARD_DISTILL_MODEL_KIMI,
    );
  });

  it("falls back on unknown id", () => {
    expect(resolveKnowledgeCardDistillModel("not-a-model")).toBe(KNOWLEDGE_CARD_DISTILL_MODEL_QWEN);
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
    expect(chunks.join("").length).toBeGreaterThan(9000);
  });
});
