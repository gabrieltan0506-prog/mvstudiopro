import { knowledgeEditionParts } from "@shared/knowledgeCardEdition";
import { knowledgeEditionImageChars, knowledgeEditionImagePlan } from "@shared/knowledgeCardPagination";
import { knowledgeEditionBudgetCheck } from "@shared/knowledgeEditionBudget";
import type { LayoutSource } from "@shared/editableLayout";

/**
 * 出图前确认的「文字页数」（1119 C2，站长令：确认完整版/精华版、计划图片页数与文字页数后再出图）。
 * - 两档方案稿：与稿件区「图文同页 · 内文约 N 页」同一口径（knowledgeEditionBudgetCheck.plannedTextPages）；完整版不排独立内文页 = 0。
 * - 旧格式稿：按将要写入云稿的同步源里无配图任务的页数计。
 * - 只出卡片：不成册，文字页 0。
 * 只读计算，不发请求、不收费；算不出时返回 null，由弹窗显示「排版时核算」。
 */
export function knowledgeCardPlannedTextPages(illustrationMarkdown: string, source: Pick<LayoutSource, "pages"> | null, cardsOnly = false): number | null {
  if (cardsOnly) return 0;
  const parts = knowledgeEditionParts(illustrationMarkdown);
  if (parts) {
    try {
      const topics = knowledgeEditionImagePlan(illustrationMarkdown);
      if (!topics) return null;
      return knowledgeEditionBudgetCheck(parts.level, topics.images.length, topics.readingChars, knowledgeEditionImageChars(topics)).plannedTextPages;
    } catch {
      return null;
    }
  }
  const pages = source?.pages;
  if (!pages) return null;
  return pages.filter((page) => !page.imageJobId).length;
}
