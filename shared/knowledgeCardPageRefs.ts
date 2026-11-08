/**
 * 「参考原页」标记（0908）：提炼稿小节末尾的 `〔参考原页 {docKey}:p41,p161〕`。
 * 只供服务端定位原稿页图，分页与计费前必须剥掉，不印到卡片上。
 * 放 shared：分页（knowledgeCardPagination）在 shared，服务端模块再从这里取同一份正则。
 */
// 兼容实际回包省略p或保留docKey标签；仍只接受固定身份与数字页码。
export const KNOWLEDGE_CARD_PAGE_REF_PATTERN = /〔参考原页\s+(?:docKey:)?([0-9a-f]{16}):((?:p?\d+)(?:\s*[,，、]\s*p?\d+)*)〕/g;

/** 任何形态的参考原页标记（含模型写坏的占位符、书名、区间）；只用于从读者/出图正文中剥离，不用于定位。 */
const ANY_PAGE_REF = /〔参考原页[^〕\n]{0,160}〕/g;

export function stripKnowledgeCardPageRefs(text: string): string {
  return String(text || "")
    .replace(KNOWLEDGE_CARD_PAGE_REF_PATTERN, "")
    .replace(ANY_PAGE_REF, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 规范化模型写出的参考原页标记（2026-11-08 敦煌本真实回包：`〔参考原页 docKey:p6-p7〕`、`〔参考原页《书名》p65–66〕`）：
 * - 有真实16位文档身份则沿用；本次只有一份原文件时，占位符/书名指向它；多份且无法确定时丢弃标记（不臆测引用）。
 * - 页码区间展开为逐页（最多12页），统一写回 `〔参考原页 {docKey}:p1,p2〕`；没有页码的标记丢弃。
 * 只改标记本身，不改任何正文。
 */
export function normalizeKnowledgeCardPageRefs(text: string, docKeys: readonly string[]): string {
  const unique = Array.from(new Set(docKeys.filter(k => /^[0-9a-f]{16}$/.test(k))));
  return String(text || "").replace(ANY_PAGE_REF, marker => {
    const body = marker.slice(5, -1);
    const id = body.match(/[0-9a-f]{16}/)?.[0];
    const docKey = id && (!unique.length || unique.includes(id)) ? id : unique.length === 1 ? unique[0] : "";
    if (!docKey) return "";
    const rest = id ? body.slice(body.indexOf(id) + 16) : body;
    const pages: number[] = [];
    for (const m of Array.from(rest.matchAll(/p?(\d{1,5})(?:\s*[-–—~～至到]\s*p?(\d{1,5}))?/g))) {
      const from = Number(m[1]), to = m[2] ? Number(m[2]) : from;
      if (!from || to < from || to - from > 11) { if (from) pages.push(from); continue; }
      for (let n = from; n <= to; n++) pages.push(n);
    }
    const list = Array.from(new Set(pages)).filter(n => n > 0).slice(0, 12);
    return list.length ? `〔参考原页 ${docKey}:${list.map(n => `p${n}`).join(",")}〕` : "";
  });
}
