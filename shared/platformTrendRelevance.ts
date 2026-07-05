export type TrendHotspotLike = {
  platformLabel: string;
  title: string;
  growthPercentile?: number;
  tags?: string[];
  category?: string;
};

export type TrendRelevanceInput = {
  userContext?: string;
  personaSummary?: string;
  ipIndustry?: string;
  ipAdvantage?: string;
  ipAudience?: string;
  ipFlagship?: string;
};

const STOPWORDS = new Set([
  "我是", "想", "分析", "这条", "视频", "内容", "平台", "怎么", "如何", "做", "增长", "转化", "当前", "用户", "老师",
  "视频", "适合", "专业", "本轮", "补充", "精神", "气质", "身份", "视觉", "商业", "基因", "行业", "核心", "优势",
  "目标", "受众", "旗舰", "交付", "品牌", "禁忌", "绝对", "避让", "近期", "热点", "参考", "须结合", "人设",
]);

export function extractTrendRelevanceKeywords(input: TrendRelevanceInput | string): string[] {
  const text =
    typeof input === "string"
      ? input
      : [
          input.userContext,
          input.personaSummary,
          input.ipIndustry,
          input.ipAdvantage,
          input.ipAudience,
          input.ipFlagship,
        ]
          .filter(Boolean)
          .join(" ");
  return Array.from(
    new Set(
      (String(text || "").match(/[\u4e00-\u9fa5A-Za-z]{2,}/g) || []).filter(
        (w) => w.length >= 2 && !STOPWORDS.has(w),
      ),
    ),
  ).slice(0, 16);
}

function buildHaystack(entry: TrendHotspotLike): string {
  return [entry.title, entry.category, ...(entry.tags || [])].join(" ").toLowerCase();
}

/** 关键词命中次数；0 表示与选题/文案无关 */
export function scoreTrendHotspotRelevance(entry: TrendHotspotLike, keywords: string[]): number {
  if (!keywords.length) return 0;
  const haystack = buildHaystack(entry);
  let hits = 0;
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (k.length < 2) continue;
    if (haystack.includes(k)) {
      hits += 2;
      continue;
    }
    const titleTokens = (entry.title.match(/[\u4e00-\u9fa5]{2,}/g) || []);
    if (titleTokens.some((t) => t.includes(k) || k.includes(t))) hits += 1;
  }
  return hits;
}

export type PickRelevantTrendHotspotsOptions = {
  minCount?: number;
  maxCount?: number;
  /** 至少 1 个关键词命中（score ≥ 2） */
  minScore?: number;
};

/** 从热词池里挑出 2–3 条与选题/文案相关的；无匹配则返回空，不凑数 */
export function pickRelevantTrendHotspots(
  entries: TrendHotspotLike[],
  input: TrendRelevanceInput | string,
  opts: PickRelevantTrendHotspotsOptions = {},
): TrendHotspotLike[] {
  const { minCount = 2, maxCount = 3, minScore = 2 } = opts;
  if (!entries.length) return [];

  const keywords = extractTrendRelevanceKeywords(input);
  if (!keywords.length) return [];

  const scored = entries
    .map((entry) => ({
      entry,
      score: scoreTrendHotspotRelevance(entry, keywords),
      growth: typeof entry.growthPercentile === "number" ? entry.growthPercentile : 0,
    }))
    .sort((a, b) => b.score - a.score || b.growth - a.growth);

  const relevant = scored.filter((s) => s.score >= minScore).map((s) => s.entry);
  if (relevant.length >= minCount) return relevant.slice(0, maxCount);
  if (relevant.length > 0) return relevant.slice(0, maxCount);
  return [];
}

export function formatTrendHotspotEntry(entry: TrendHotspotLike): string {
  const title = String(entry.title || "").trim();
  if (!title) return "";
  const boost =
    typeof entry.growthPercentile === "number" && entry.growthPercentile > 0
      ? ` (+${entry.growthPercentile}%↑)`
      : "";
  return `[${entry.platformLabel}] ${title}${boost}`;
}
