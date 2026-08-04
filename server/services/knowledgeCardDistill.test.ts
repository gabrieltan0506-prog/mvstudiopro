import { describe, expect, it } from "vitest";
import { KNOWLEDGE_CARD_DISTILL_MODEL } from "./knowledgeCardDistill";
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
