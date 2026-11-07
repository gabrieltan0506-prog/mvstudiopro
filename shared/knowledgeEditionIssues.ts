/** 只识别实际缺失的正文，不用药名、数字等话题关键词制造疑点。 */
export function hasKnowledgeBody(body: string) {
  return Boolean(body.replace(/<!--[\s\S]*?-->/g, '').replace(/^#{1,6}[ \t]+.*$/gm, '').replace(/^\s*(?:---+|\*\*\*+|```\w*)\s*$/gm, '').trim());
}

export type KnowledgeEditionIssue = {
  pageIndex: number;
  kind: 'empty_body' | 'content_error' | 'unresolved' | 'unknown_receipt';
  message: string;
};

/** 空章节仍留在稿中；只追加内部任务标记，不伪造知识内容。 */
export function markKnowledgeEditionGap(body: string, reason: string) {
  return `${body}\n\n<!-- 待核：${reason.replace(/-->/g, '—')} -->`;
}
