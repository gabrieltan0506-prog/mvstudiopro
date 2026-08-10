/**
 * 目标 `##` 小节数（≈ 知识卡页数的上游输入）。
 *
 * 用户 2026-08-05 明文口径：提炼的意义是**让人快速读懂全书重点**，
 * 不是把十万字逐段搬成几十页（旧式「每 1400 字 1 节」会让 9.5 万字出 68 节，读不完等于没提炼）。
 * 改为字数每翻一倍才多约 5 节：1 万字≈10 节 / 3 万字≈19 节 / 9.5 万字≈28 节，上限 36 节。
 *
 * 注意：小节数 ≠ 页数。一页横版卡片可容纳数个小节，见 `planKnowledgeCardPages`。
 *
 * 放在 shared 是因为前端要用它预估「提炼后大概几页」，好在弹窗里跟直接出图算账；
 * 服务端 `knowledgeCardDistill` 仍从这里取同一份实现，避免两边算出不同的页数。
 */
export function suggestKnowledgeCardMinSections(sourceChars: number): number {
  const n = Math.max(0, Math.floor(Number(sourceChars) || 0));
  if (n < 80) return 1;
  if (n < 480) return 2;
  if (n <= 3_000) return Math.max(3, Math.ceil(n / 700));
  return Math.min(36, Math.max(5, Math.round(10 + 5.5 * Math.log2(n / 10_000))));
}
