/**
 * 目标 `##` 小节数（≈ 知识卡页数的上游输入）。
 *
 * 2026-09-08 用户拍板分两档成稿：
 * - 精华版（concise）：提炼主要重点。字数每翻一倍才多约 5 节：1 万字≈10 节 / 3 万字≈19 节 /
 *   9.5 万字≈28 节，上限 36 节（2026-08-05 口径）。
 * - 高级版（full）：主要 + 次要重点都包含，不限页数，**尽量表格化/图表化**承载压实。
 *   目标节数按约每 1,400 字 1 节，且不少于精华版的两倍，上限 96 节。
 *
 * 注意：小节数 ≠ 页数。一页横版卡片可容纳数个小节，见 `planKnowledgeCardPages`。
 *
 * 放在 shared 是因为前端要用它预估「提炼后大概几页」，好在弹窗里跟直接出图算账；
 * 服务端 `knowledgeCardDistill` 仍从这里取同一份实现，避免两边算出不同的页数。
 */
export const KNOWLEDGE_CARD_DETAIL_LEVELS = ["concise", "full"] as const;
export type KnowledgeCardDetailLevel = (typeof KNOWLEDGE_CARD_DETAIL_LEVELS)[number];
export const KNOWLEDGE_CARD_DEFAULT_DETAIL_LEVEL: KnowledgeCardDetailLevel = "concise";
/** 0908 用户定名：精华版 = 提炼主要重点；高级版 = 主要 + 次要重点都包含，不限页数，靠表格化压实 */
export const KNOWLEDGE_CARD_DETAIL_LEVEL_LABEL_ZH: Record<KnowledgeCardDetailLevel, string> = {
  concise: "精华版",
  full: "高级版",
};

export function resolveKnowledgeCardDetailLevel(raw?: unknown): KnowledgeCardDetailLevel {
  return String(raw ?? "").trim().toLowerCase() === "full" ? "full" : "concise";
}

export function suggestKnowledgeCardMinSections(
  sourceChars: number,
  detailLevel: KnowledgeCardDetailLevel = "concise",
): number {
  const n = Math.max(0, Math.floor(Number(sourceChars) || 0));
  let concise: number;
  if (n < 80) concise = 1;
  else if (n < 480) concise = 2;
  else if (n <= 3_000) concise = Math.max(3, Math.ceil(n / 700));
  else concise = Math.min(36, Math.max(5, Math.round(10 + 5.5 * Math.log2(n / 10_000))));
  if (detailLevel !== "full" || n <= 3_000) return concise;
  return Math.min(96, Math.max(concise * 2, Math.ceil(n / 1_400)));
}
