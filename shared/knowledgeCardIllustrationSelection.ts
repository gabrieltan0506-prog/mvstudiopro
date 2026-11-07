import { planKnowledgeCardPages } from "./knowledgeCardPagination";
import { assertKnowledgeCardDeriveTablesComplete } from "./knowledgeCardDeriveIntegrity";
import {knowledgeEditionParts} from './knowledgeCardEdition';

/** 仅限制精华版的重点配图，不限制或截短完整文字稿。 */
export const KNOWLEDGE_CARD_MAX_KEY_ILLUSTRATIONS = 20;
export function assertKnowledgeCardIllustrationSelection(markdown: string, model?: string | null): void {
  // 新版先编辑再分配图文，页数按真实方案报价；格式或数量偏好不触发拒收/重购。
  if(knowledgeEditionParts(markdown))return;
  assertKnowledgeCardDeriveTablesComplete(markdown);
  const pages = planKnowledgeCardPages(markdown, model).pageCount;
  if (pages > KNOWLEDGE_CARD_MAX_KEY_ILLUSTRATIONS)
    throw new Error(`重点配图仍有 ${pages} 张，超过 ${KNOWLEDGE_CARD_MAX_KEY_ILLUSTRATIONS} 张；需重新选择重点，完整正文不变`);
}
