import { assertKnowledgeCardDeriveTablesComplete } from "./knowledgeCardDeriveIntegrity";
import {knowledgeEditionParts} from './knowledgeCardEdition';

/** 校验真实配图输入；页数按1200字分页报价，不以固定张数强压正文。 */
export function assertKnowledgeCardIllustrationSelection(markdown: string, model?: string | null): void {
  if(knowledgeEditionParts(markdown))return;
  assertKnowledgeCardDeriveTablesComplete(markdown);
}
