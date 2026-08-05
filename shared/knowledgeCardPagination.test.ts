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
  stripKnowledgeCardInternalDirectives,
} from "./knowledgeCardPagination";
import { composeInfographicScriptContext } from "./infographicNoteTemplates";
import { composePlatformImageSkillHints } from "./platformNativeVariants";
import {
  formatAssignedCraftTechniqueZh,
  pickCraftTechniqueProfile,
} from "./storyboardLightingEmotion";

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

  // 用户 2026-08-05 样张：16:9 横版一页承载 4–6 个模块，别一节一页把 28 节摊成 28 张
  it("packs several sections onto one landscape page", () => {
    const sections = Array.from(
      { length: 16 },
      (_, i) => `## 章${i + 1}\n\n${repeatBlock(`C${i}`, 200)}`,
    ).join("\n\n");
    const plan = planKnowledgeCardPages(`# 长篇精华\n\n${sections}`);
    expect(plan.pageCount).toBeLessThanOrEqual(6);
    expect(plan.pageCount).toBeGreaterThanOrEqual(3);
    expect(plan.credits).toBe(knowledgeCardCreditsForPages(plan.pageCount));
    // 并页不能丢内容
    for (let i = 1; i <= 16; i += 1) {
      expect(plan.pages.some((p) => p.includes(`章${i}\n`) || p.includes(`章${i} `))).toBe(true);
    }
  });

  it("splits by char cap without rejecting", () => {
    const body = repeatBlock("超长", KNOWLEDGE_CARD_MAX_CHARS_PER_PAGE * 14);
    const plan = planKnowledgeCardPages(`# 超长主题\n\n${body}`);
    expect(plan.pageCount).toBeGreaterThan(12);
    expect(plan.pages.length).toBe(plan.pageCount);
  });

  // 用户 2026-08-05：第 1 页整页印的是内部出图约束（coverHeadline / A1 壳 / mk3），正文从第 2 页才开始
  it("never paginates injected image directives as body content", () => {
    const hints = composePlatformImageSkillHints(null, {
      sheetKind: "graphic",
      forceCoverShortCopy: true,
    });
    expect(hints).toContain("coverHeadline");
    const body = `# 前线部署工程师\n\n${Array.from(
      { length: 8 },
      (_, i) => `## 要点${i + 1}\n\n${repeatBlock(`P${i}`, 200)}`,
    ).join("\n\n")}`;

    const clean = planKnowledgeCardPages(body);
    const polluted = planKnowledgeCardPages(`${hints}\n\n${body}`);

    expect(polluted.pages[0]).toContain("前线部署工程师");
    for (const page of polluted.pages) {
      expect(page).not.toContain("coverHeadline");
      expect(page).not.toContain("A1 壳");
      expect(page).not.toContain("mk3");
    }
    // 约束还会撑出额外页数：用户看到的是 1/7 而不是 1/6
    expect(polluted.pageCount).toBe(clean.pageCount);
  });
});

describe("stripKnowledgeCardInternalDirectives", () => {
  it("keeps untouched text as-is", () => {
    const text = "# 正常文档\n\n## 小节\n\n正文内容。";
    expect(stripKnowledgeCardInternalDirectives(text)).toBe(text);
  });

  // 用户 2026-08-05：第 3 页整页是手法卡被扩写的「连载节奏／镜头语言／对峙处理」，与 FDE 文档无关
  it("drops craft-card sections even after the model rewrites them into ## headings", () => {
    const text = [
      "# FDE：让现场交付转化为企业 AI 价值",
      "## FDE 核心定义与价值定位",
      "FDE = 现场交付工程师，连接客户现场与企业产品。",
      "## 连载节奏——每格留「下一拍」",
      "稳镜听戏、微推强调决断；对峙用缓慢环绕或固定对切。",
      "## 落地实践：从 0 到 1 的执行清单",
      "明确目标、搭建流程、工具赋能。",
    ].join("\n\n");
    const out = stripKnowledgeCardInternalDirectives(text);
    expect(out).toContain("FDE 核心定义与价值定位");
    expect(out).toContain("落地实践");
    expect(out).not.toContain("稳镜听戏");
    expect(out).not.toContain("下一拍");
  });

  it("drops the graphic craft card in its raw injected form", () => {
    const profile = pickCraftTechniqueProfile("fde:1");
    const card = formatAssignedCraftTechniqueZh(profile, { forGraphic: true });
    const text = `${card}\n\n# 用户文档\n\n## 小节一\n\n正文。`;
    const out = stripKnowledgeCardInternalDirectives(text);
    expect(out).toBe("# 用户文档\n\n## 小节一\n\n正文。");
    expect(out).not.toContain("系统手法卡 id");
  });

  it("falls back to the original when stripping would empty it", () => {
    const onlyDirectives = "【Platform 出图短约束】\n【封面出图·高点击短钩】略。";
    expect(stripKnowledgeCardInternalDirectives(onlyDirectives)).toBe(onlyDirectives);
  });

  it("drops craft cards and fashion guidance blocks", () => {
    const text = [
      "【本条图文·视觉气质手法卡】某手法说明。",
      "【人物造型·国际时尚大片】某造型说明。",
      "# 用户文档",
      "正文。",
    ].join("\n\n");
    const out = stripKnowledgeCardInternalDirectives(text);
    expect(out).toBe("# 用户文档\n\n正文。");
  });

  /**
   * 用户 2026-08-05：随机选了「左右对半对比」版式跑轻量档，第 1 页整页印成
   * 模板说明书（标题即版式名，六个模块即 SECTION 1–5 与「内容锁定·强制」）。
   * 版式已改走出图指令，这里是防再犯的第二道闸。
   */
  it("drops the infographic layout block composed for image generation", () => {
    const layoutBlock = composeInfographicScriptContext({
      templateId: "infographic_rival_showdown",
      userCopy: "# FDE 全书精华\n\n## 什么是 FDE\n\n现场交付工程师连接客户现场与产品。",
    });
    const out = stripKnowledgeCardInternalDirectives(layoutBlock);
    expect(out).toContain("什么是 FDE");
    expect(out).not.toContain("图文可视化模板");
    expect(out).not.toContain("左右对半对比");
    expect(out).not.toContain("P.A.M.S");
    expect(out).not.toContain("LAYOUT ONLY");
    expect(out).not.toContain("内容锁定");
  });
});
