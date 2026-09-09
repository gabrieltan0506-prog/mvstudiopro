/**
 * 漫剧图片/视频节点 outputUrls 历史上限（全链唯一常量）。
 * 旧值 8 让付费出图过八张就悄悄丢掉更早版本；现统一 30，
 * 生成写回 / 编辑写回 / 本机落盘 / 云草稿清洗都必须走这里。
 */
export const MANHUA_MEDIA_HISTORY_MAX = 30;

/**
 * 截断历史：去重、保留最新（数组前部）、并且永远保住当前选中的 outputUrl。
 * 若选中版本落在上限之外，则以它顶替最后一位，绝不因截断丢当前图。
 */
export function capManhuaMediaHistory(
  urls: readonly (string | null | undefined)[],
  keepUrl?: string | null,
  max: number = MANHUA_MEDIA_HISTORY_MAX,
): string[] {
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const raw of urls) {
    const u = String(raw || "").trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    uniq.push(u);
  }
  const keep = String(keepUrl || "").trim();
  if (uniq.length <= max) return uniq;
  const head = uniq.slice(0, max);
  if (keep && seen.has(keep) && !head.includes(keep)) {
    head[max - 1] = keep;
  }
  return head;
}
