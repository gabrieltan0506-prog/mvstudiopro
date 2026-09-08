/**
 * 「参考原页」标记（0908）：提炼稿小节末尾的 `〔参考原页 {docKey}:p41,p161〕`。
 * 只供服务端定位原稿页图，分页与计费前必须剥掉，不印到卡片上。
 * 放 shared：分页（knowledgeCardPagination）在 shared，服务端模块再从这里取同一份正则。
 */
export const KNOWLEDGE_CARD_PAGE_REF_PATTERN = /〔参考原页\s+([0-9a-f]{16}):((?:p\d+)(?:\s*[,，、]\s*p\d+)*)〕/g;

export function stripKnowledgeCardPageRefs(text: string): string {
  return String(text || "")
    .replace(KNOWLEDGE_CARD_PAGE_REF_PATTERN, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
