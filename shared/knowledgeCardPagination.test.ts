import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_CARD_DISTILL_MODEL_KIMI,
  KNOWLEDGE_CARD_DISTILL_MODEL_QWEN,
  KNOWLEDGE_CARD_DISTILL_MODEL_SOL,
} from "./knowledgeCardDistillModels";
import {
  KNOWLEDGE_CARD_MAX_CHARS_PER_PAGE,
  knowledgeCardCreditsForPageIndex,
  knowledgeCardCreditsForPages,
  knowledgeCardImageQuality,
  planKnowledgeCardPages,
  shouldSkipKnowledgeCardDistill,
} from "./knowledgeCardPagination";

function repeatBlock(label: string, chars: number): string {
  const unit = `${label}要点说明。`;
  return unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);
}

describe("knowledgeCardCreditsForPages", () => {
  it("defaults to 精细(Sol) 30/24", () => {
    expect(knowledgeCardCreditsForPages(4)).toBe(120);
    expect(knowledgeCardCreditsForPages(8)).toBe(240);
    expect(knowledgeCardCreditsForPages(10)).toBe(240 + 2 * 24);
    expect(knowledgeCardCreditsForPages(15)).toBe(240 + 7 * 24);
  });

  it("tiers by distill model", () => {
    expect(knowledgeCardCreditsForPages(4, KNOWLEDGE_CARD_DISTILL_MODEL_QWEN)).toBe(96);
    expect(knowledgeCardCreditsForPages(4, KNOWLEDGE_CARD_DISTILL_MODEL_KIMI)).toBe(108);
    expect(knowledgeCardCreditsForPages(4, KNOWLEDGE_CARD_DISTILL_MODEL_SOL)).toBe(120);
  });

  it("floors invalid", () => {
    expect(knowledgeCardCreditsForPages(0)).toBe(0);
    expect(knowledgeCardCreditsForPages(-3)).toBe(0);
  });
});

describe("knowledgeCardCreditsForPageIndex", () => {
  it("full price 1–8, discount from 9 onward (Sol default)", () => {
    expect(knowledgeCardCreditsForPageIndex(1)).toBe(30);
    expect(knowledgeCardCreditsForPageIndex(8)).toBe(30);
    expect(knowledgeCardCreditsForPageIndex(9)).toBe(24);
    expect(knowledgeCardCreditsForPageIndex(20)).toBe(24);
  });

  it("uses Qwen/Kimi page rates", () => {
    expect(knowledgeCardCreditsForPageIndex(1, KNOWLEDGE_CARD_DISTILL_MODEL_QWEN)).toBe(24);
    expect(knowledgeCardCreditsForPageIndex(9, KNOWLEDGE_CARD_DISTILL_MODEL_QWEN)).toBe(19);
    expect(knowledgeCardCreditsForPageIndex(1, KNOWLEDGE_CARD_DISTILL_MODEL_KIMI)).toBe(27);
    expect(knowledgeCardCreditsForPageIndex(9, KNOWLEDGE_CARD_DISTILL_MODEL_KIMI)).toBe(22);
  });
});

describe("knowledgeCardImageQuality", () => {
  it("uses 4K (high) for 1–6 pages and 2K (medium) for every page when total > 6", () => {
    expect(knowledgeCardImageQuality(1)).toBe("high");
    expect(knowledgeCardImageQuality(6)).toBe("high");
    expect(knowledgeCardImageQuality(7)).toBe("medium");
    expect(knowledgeCardImageQuality(20)).toBe("medium");
  });
});

describe("shouldSkipKnowledgeCardDistill", () => {
  it("skips short paste without uploads", () => {
    expect(shouldSkipKnowledgeCardDistill("已经提练过的短文案".repeat(10), false)).toBe(true);
  });
  it("never skips when uploads present", () => {
    expect(shouldSkipKnowledgeCardDistill("短", true)).toBe(false);
  });
});

describe("planKnowledgeCardPages", () => {
  it("returns empty for blank", () => {
    expect(planKnowledgeCardPages("")).toEqual({
      pages: [],
      pageCount: 0,
      credits: 0,
      roundText: "",
      distillModel: KNOWLEDGE_CARD_DISTILL_MODEL_SOL,
    });
  });

  it("keeps very short text as 1 page", () => {
    const plan = planKnowledgeCardPages("短文一条要点即可。");
    expect(plan.pageCount).toBe(1);
    expect(plan.credits).toBe(30);
  });

  it("splits mid-length prose into about 4–8 pages", () => {
    const body = repeatBlock("中文", 2200);
    const plan = planKnowledgeCardPages(`# 主题\n\n${body}`);
    expect(plan.pageCount).toBeGreaterThanOrEqual(4);
    expect(plan.pageCount).toBeLessThanOrEqual(8);
  });

  it("uses ## sections when present", () => {
    const sections = Array.from({ length: 6 }, (_, i) => `## 小节${i + 1}\n\n${repeatBlock(`S${i}`, 180)}`).join(
      "\n\n",
    );
    const plan = planKnowledgeCardPages(`# 大标题\n\n导语一段。\n\n${sections}`);
    expect(plan.pageCount).toBeGreaterThanOrEqual(4);
    expect(plan.pages.some((p) => p.includes("小节1"))).toBe(true);
  });

  it("allows more than 12 pages for long distilled content", () => {
    const sections = Array.from(
      { length: 16 },
      (_, i) => `## 章${i + 1}\n\n${repeatBlock(`C${i}`, 200)}`,
    ).join("\n\n");
    const plan = planKnowledgeCardPages(`# 长篇精华\n\n${sections}`);
    expect(plan.pageCount).toBeGreaterThan(12);
    expect(plan.credits).toBe(knowledgeCardCreditsForPages(plan.pageCount));
  });

  it("splits by char cap without rejecting", () => {
    const body = repeatBlock("超长", KNOWLEDGE_CARD_MAX_CHARS_PER_PAGE * 14);
    const plan = planKnowledgeCardPages(`# 超长主题\n\n${body}`);
    expect(plan.pageCount).toBeGreaterThan(12);
    expect(plan.pages.length).toBe(plan.pageCount);
  });
});
