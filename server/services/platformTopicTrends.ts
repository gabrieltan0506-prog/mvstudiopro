import { queryTrendShortlist } from "../growth/trendShortlistQuery";
import path from "node:path";
import { readTrendShortlistIndex, ensureTrendShortlistIndex } from "../growth/trendShortlistIndex";
import { buildXhsGrowthEvidence, type XhsGrowthEvidence } from "../../shared/xhsContentStrategy";
/** 本机趋势读盘上限（不再打冷仓；仍加竞速以免偶发卡死） */
const SHORTLIST_TREND_READ_TIMEOUT_MS = 5_000;

type ShortlistTrendBrief = {
  platform: "xiaohongshu" | "bilibili" | "douyin";
  role: "主参考" | "辅参考";
  hotTitles: string[];
  hotTags: string[];
  /** 评论区最热的一批：不看总热度，只看「大家有多想留言」 */
  commentHotTitles: Array<{ title: string; comments: number; commentPerThousandLikes: number | null }>;
};

/** 缺失日期、未来日期与窗口外样本不能退回充当近期依据。 */
export function filterTrendRowsToWindow(rows: Array<Record<string, unknown>>, windowDays = 15): Array<Record<string, unknown>> {
  const now = Date.now(), cutoff = now - windowDays * 86400000;
  return rows.filter(row => {
    const raw = row.publishedAt;
    const text = String(raw ?? "");
    const at = /^\d{10}(?:\d{3})?$/.test(text) ? Number(text) * (text.length === 10 ? 1000 : 1) :
      /^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:?\d{2}))?$/.test(text) ? Date.parse(text) : NaN;
    return Number.isFinite(at) && at >= cutoff && at <= now;
  });
}

/** 入提示词前即排除不能核对来源或没有互动记录的候选，不让模型把记录日期当发布日期。 */
export function buildRecentTopicEvidence(rows: Array<Record<string, unknown>>, days: number, context: string, platform: "xiaohongshu" | "douyin") {
  const usable = filterTrendRowsToWindow(rows, days).filter(row => {
    try {
      const url = new URL(String(row.url || row.sourceUrl || row.noteUrl || ""));
      const hasMetric = [row.likes, row.comments].some(value => value != null && (typeof value === "number" || typeof value === "string") && String(value).trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0);
      return ["https:", "http:"].includes(url.protocol) && hasMetric;
    } catch { return false; }
  });
  const evidence = buildXhsGrowthEvidence(usable, days, Date.now(), context, platform);
  evidence.note = `扫描候选${rows.length}条，仅保留窗口内发布、来源可核对且有互动记录的候选${usable.length}条。` + evidence.note;
  return evidence;
}

/**
 * 初选前先查本机热门样本：小红书主、B站+抖音辅。
 * 只读 volume 本地文件，**不打冷仓**；读失败返回空数组继续出题。
 */
export async function readShortlistTrendBriefs(windowDays?: number | null, xhsMode = false, context = "", creationPlatforms: Array<"xiaohongshu" | "douyin"> = ["xiaohongshu"]): Promise<{
  briefs: ShortlistTrendBrief[];
  xhsGrowthEvidence?: XhsGrowthEvidence;
  douyinGrowthEvidence?: XhsGrowthEvidence;
  status: "ok" | "timeout" | "error" | "empty";
  readDiagnostics?: Record<string, { status: string; sourceCount: number; totalItems?: number }>;
}> {
  const platforms = [
    { platform: "xiaohongshu" as const, role: "主参考" as const, titleCap: 30 },
    { platform: "bilibili" as const, role: "辅参考" as const, titleCap: 20 },
    { platform: "douyin" as const, role: "辅参考" as const, titleCap: 20 },
  ].filter(p => !xhsMode || creationPlatforms.includes(p.platform as "xiaohongshu" | "douyin"));
  try {
    const readLocalTrendCollectionsForPlatforms = async (platforms: Array<"xiaohongshu" | "douyin" | "bilibili">) => Object.fromEntries(await Promise.all(platforms.map(async platform => {
      const root = path.resolve(process.env.GROWTH_STORE_DIR || path.join(process.cwd(), ".cache/growth"));
      const collection = xhsMode ? await queryTrendShortlist(root, platform as "xiaohongshu" | "douyin", context, windowDays ?? 15) : await readTrendShortlistIndex(root, platform).catch(async () => { await ensureTrendShortlistIndex(root, platform); return readTrendShortlistIndex(root, platform); });
      return [platform, collection] as const;
    })));
    /**
     * 逐平台读、各自计时：库里有哪个就用哪个（用户 2026-08-06）。
     * 旧写法是三平台一起 race 一个 5 秒闸门，小红书慢一点就把 B站 / 抖音的现成数据一起丢掉，
     * 结果整批题都没有热点支撑。
     */
    const perPlatform = await Promise.all(
      platforms.map(async ({ platform }) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const got = await Promise.race([
            readLocalTrendCollectionsForPlatforms([platform]),
            new Promise<null>((resolve) =>
              timer = setTimeout(() => resolve(null), xhsMode ? 65_000 : SHORTLIST_TREND_READ_TIMEOUT_MS),
            ),
          ]);
          if (!got) {
            console.warn(`[generatePlatformTopicShortlist] ${platform} 趋势读取超时，跳过该平台`);
            return [platform, undefined, "timeout"] as const;
          }
          return [platform, got[platform], got[platform]?.items.length ? "ok" : "empty"] as const;
        } catch (e) {
          console.warn(
            `[generatePlatformTopicShortlist] ${platform} 趋势读取失败: ${
              e instanceof Error ? e.message.slice(0, 120) : e
            }`,
          );
          return [platform, undefined, e instanceof Error && ["TimeoutError", "AbortError"].includes(e.name) ? "timeout" : e instanceof Error && e.message === "shortlist_index_not_ready" ? "index_not_ready" : "error"] as const;
        } finally { if (timer) clearTimeout(timer); }
      }),
    );
    const collections = Object.fromEntries(perPlatform) as Record<
      string,
      { items?: unknown; shortlistCoverage?: { totalItems: number }; queryCoverage?: { totalItems: number; matchedItems: number } } | undefined
    >;
    const readDiagnostics = Object.fromEntries(perPlatform.map(([platform, collection, status]) => [platform, {
      status, sourceCount: collection?.items.length || 0, totalItems: collection && ("queryCoverage" in collection ? collection.queryCoverage.totalItems : collection.shortlistCoverage?.totalItems),
    }]));
    const briefs: ShortlistTrendBrief[] = [];
    const xhsItems = collections.xiaohongshu?.items;
    const xhsGrowthEvidence = xhsMode && creationPlatforms.includes("xiaohongshu") ? buildRecentTopicEvidence(Array.isArray(xhsItems) ? xhsItems : [], windowDays ?? 15, context, "xiaohongshu") : undefined;
    const douyinItems = collections.douyin?.items;
    const douyinGrowthEvidence = xhsMode && creationPlatforms.includes("douyin") ? buildRecentTopicEvidence(Array.isArray(douyinItems) ? douyinItems : [], windowDays ?? 15, context, "douyin") : undefined;
    for (const evidence of [xhsGrowthEvidence, douyinGrowthEvidence]) {
      if (evidence && collections[evidence.platform || "xiaohongshu"]?.queryCoverage) {
        const coverage = collections[evidence.platform || "xiaohongshu"]!.queryCoverage!;
        evidence.note = `按本轮主题扫描采集库${coverage.totalItems}条，窗口内词匹配${coverage.matchedItems}条；以下为有界候选摘要，非平台全量统计。${evidence.note}`;
      }
      if (evidence && collections[evidence.platform || "xiaohongshu"]?.shortlistCoverage) {
        evidence.note = `近期优先抽样的选题参考池，非完整采集库。${evidence.note}`;
      }
    }
    for (const { platform, role, titleCap } of platforms) {
      if (xhsMode && !creationPlatforms.includes(platform as "xiaohongshu" | "douyin")) continue;
      const items = collections[platform]?.items;
      if (!Array.isArray(items) || !items.length) continue;
      // 新能力使用带出处的严格摘要；旧入口同样不得用窗口外数据冒充近期。
      const rows: Array<Record<string, unknown>> = xhsMode
        ? ((platform === "douyin" ? douyinGrowthEvidence : xhsGrowthEvidence)?.samples || []).map(sample => ({ ...sample }))
        : filterTrendRowsToWindow(items as Array<Record<string, unknown>>, windowDays ?? 15);
      if (!rows.length) continue;
      const ranked = [...rows].sort(
        (a, b) => Number(b.hotValue || b.likes || 0) - Number(a.hotValue || a.likes || 0),
      );
      const hotTitles = ranked
        .map((r) => String(r.title || "").trim())
        .filter(Boolean)
        .slice(0, titleCap);
      const tagFreq = new Map<string, number>();
      for (const r of ranked.slice(0, 600)) {
        for (const t of Array.isArray(r.tags) ? (r.tags as unknown[]) : []) {
          const tag = String(t || "").trim();
          if (!tag) continue;
          tagFreq.set(tag, (tagFreq.get(tag) || 0) + 1);
        }
      }
      const hotTags = Array.from(tagFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([tag]) => tag);
      // 评论区热度：按评论数排，并给出「每千赞带来多少评论」——纯高赞但没人说话的不算热
      const commentHotTitles = [...rows]
        .filter((r) => Number(r.comments || 0) > 0 && String(r.title || "").trim())
        .sort((a, b) => Number(b.comments || 0) - Number(a.comments || 0))
        .slice(0, 12)
        .map((r) => {
          const comments = Number(r.comments || 0);
          const likes = Number(r.likes || 0);
          return {
            title: String(r.title || "").trim(),
            comments,
            commentPerThousandLikes: likes > 0 ? Math.round((comments / likes) * 1000) : null,
          };
        });
      if (hotTitles.length) briefs.push({ platform, role, hotTitles, hotTags, commentHotTitles });
    }
    if (briefs.length) return { briefs, xhsGrowthEvidence, douyinGrowthEvidence, readDiagnostics, status: "ok" };
    return { briefs, xhsGrowthEvidence, douyinGrowthEvidence, readDiagnostics,
      status: perPlatform.some(([, , status]) => status === "timeout") ? "timeout"
        : perPlatform.some(([, , status]) => status === "error" || status === "index_not_ready") ? "error" : "empty" };
  } catch (err) {
    console.warn(
      `[generatePlatformTopicShortlist] 本机趋势读取失败: ${err instanceof Error ? err.message : String(err)}`.slice(
        0,
        200,
      ),
    );
    return { briefs: [], status: "error", ...(xhsMode ? { xhsGrowthEvidence: buildXhsGrowthEvidence([], windowDays ?? 15) } : {}) };
  }
}
