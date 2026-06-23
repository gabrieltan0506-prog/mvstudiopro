import type { readTrendStore } from "../growth/trendStore.js";

const DOUYIN_INDEX_BUCKET_PREFIX = "douyin_creator_index";

type TrendStoreShape = Awaited<ReturnType<typeof readTrendStore>>;

/**
 * 从 trendStore 抖音采集桶提取创作者指数信号摘要，供 Stage2 选题与 Google Search 对齐。
 */
export function buildDouyinIndexBriefFromStore(
  store: TrendStoreShape,
  opts?: { keywordHints?: string[]; maxItems?: number },
): string {
  const items: Array<{ title?: string; bucket?: string; hotValue?: number; label?: string; tags?: string[] }> =
    (store.collections?.douyin?.items as typeof items) || [];
  const maxItems = Math.max(3, Math.min(24, opts?.maxItems ?? 12));
  const hints = (opts?.keywordHints || [])
    .map((k) => String(k || "").trim().toLowerCase())
    .filter(Boolean);

  const indexItems = items.filter((it) =>
    String(it.bucket || "").includes(DOUYIN_INDEX_BUCKET_PREFIX),
  );

  const scored = indexItems
    .map((it) => {
      const title = String(it.title || "").trim();
      const label = String((it as { label?: string }).label || "").trim();
      const hot = Number(it.hotValue ?? 0) || 0;
      let hintBoost = 0;
      if (hints.length) {
        const blob = `${title} ${label}`.toLowerCase();
        hintBoost = hints.some((h) => blob.includes(h)) ? 40 : 0;
      }
      return { it, score: hot + hintBoost, title, label, bucket: String(it.bucket || "") };
    })
    .filter((row) => row.title)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxItems);

  if (scored.length === 0) {
    return "【抖音创作者指数】当前窗口暂无可用指数信号样本；选题须保守结合 Google 搜索与平台资料库。";
  }

  const lines = scored.map((row, i) => {
    const kind = row.bucket.replace(DOUYIN_INDEX_BUCKET_PREFIX, "").replace(/^_?/, "") || "signal";
    const labelPart = row.label ? ` · ${row.label}` : "";
    return `${i + 1}. [${kind}] ${row.title}${labelPart}`;
  });

  return `【抖音创作者指数 · trendStore 信号】\n${lines.join("\n")}\n（指数信号来自采集桶，非实时 API；须与人设交叉验证后再用于选题）`;
}

/** 从用户 context 提取 2-4 个关键词供指数匹配加权 */
export function extractKeywordHintsFromContext(context: string): string[] {
  const text = String(context || "").trim();
  if (!text) return [];
  const chunks = text
    .split(/[\s,，。；;、|/]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 12);
  const uniq = Array.from(new Set(chunks));
  return uniq.slice(0, 6);
}
