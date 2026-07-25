/**
 * 段提示词里的 `@` 唤起语境判定。
 *
 * 资产 id 形如 cust_mrwxm9q3_qcioz，靠人去别处翻等于逼人放弃锁定；改成敲 @
 * 就地挑。这里只判「光标此刻是否在挂资产」，面板与插入交给组件。
 */
export function readMentionQuery(
  text: string,
  caret: number,
): { at: number; query: string } | null {
  for (let i = caret - 1; i >= 0 && caret - i <= 12; i--) {
    const ch = text[i]!;
    if (ch === "@") return { at: i, query: text.slice(i + 1, caret) };
    // 换行或空格之前没遇到 @ 就不是在挂资产
    if (ch === "\n" || ch === " " || ch === "\t") return null;
  }
  return null;
}
