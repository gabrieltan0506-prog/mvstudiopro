import { normalizePlatforms } from "../growth/growthSchema.js";
import { readTrendStoreForPlatforms } from "../growth/trendStore.js";
import {
  buildDouyinIndexBriefFromStore,
  extractKeywordHintsFromContext,
} from "./douyinIndexBriefFromStore.js";

const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  bilibili: "B站",
  kuaishou: "快手",
};

function readItemTs(item: Record<string, unknown>): number {
  const ts =
    item.collectedAt ||
    item.collected_at ||
    item.publishedAt ||
    item.published_at ||
    item.createdAt ||
    null;
  if (!ts) return 0;
  const ms = new Date(String(ts)).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * 为深度定位访谈组装「数据快照摘要」：四平台样本 + 抖音指数 + 快照 topic 信号。
 * 供 prompt 提交后立即结合数据反问用户。
 */
export async function buildPlatformPositioningDataSnapshotBrief(opts: {
  userPrompt: string;
  windowDays?: number;
  snapshotSummary?: Record<string, unknown> | null;
  timeoutMs?: number;
}): Promise<{ brief: string; storeReadMs: number; hasLiveData: boolean }> {
  const t0 = Date.now();
  const platforms = normalizePlatforms(["douyin", "xiaohongshu", "bilibili", "kuaishou"]);
  const timeoutMs = opts.timeoutMs ?? 18_000;
  const storeNull = { collections: {}, history: null, backfill: null };
  const store = await Promise.race([
    readTrendStoreForPlatforms(platforms, { preferDerivedFiles: true, preferFlyLive: true }),
    new Promise<typeof storeNull>((resolve) => setTimeout(() => resolve(storeNull), timeoutMs)),
  ]).catch(() => storeNull);

  const keywordHints = extractKeywordHintsFromContext(opts.userPrompt);
  const douyinIndex = buildDouyinIndexBriefFromStore(store as Awaited<ReturnType<typeof readTrendStoreForPlatforms>>, {
    keywordHints,
    maxItems: 10,
  });

  const platformLines = platforms.map((platform) => {
    const col = (store.collections as Record<string, { items?: unknown[]; collectedAt?: string }>)?.[platform];
    const items = (col?.items || []) as Array<Record<string, unknown>>;
    const sorted = [...items].sort((a, b) => readItemTs(b) - readItemTs(a));
    const hotTitles = sorted
      .map((it) => String(it.title || "").trim())
      .filter(Boolean)
      .slice(0, 5);
    const buckets = new Map<string, number>();
    for (const it of items) {
      const b = String(it.bucket || "unknown");
      buckets.set(b, (buckets.get(b) || 0) + 1);
    }
    const topBuckets = Array.from(buckets.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([b, n]) => `${b}(${n})`)
      .join(", ");
    const label = PLATFORM_LABELS[platform] || platform;
    return `- ${label}：样本 ${items.length} 条${col?.collectedAt ? ` · 采集 ${String(col.collectedAt).slice(0, 10)}` : ""}\n  近期标题：${hotTitles.length ? hotTitles.join(" | ") : "（暂无）"}\n  主要桶：${topBuckets || "—"}`;
  });

  const snap = opts.snapshotSummary || {};
  const platformSnapshots = (snap.platformSnapshots as Array<Record<string, unknown>>) || [];
  const snapLines = platformSnapshots.slice(0, 4).map((ps) => {
    const name = PLATFORM_LABELS[String(ps.platform || "")] || ps.displayName || ps.platform;
    const topics = ((ps.sampleTopics as string[]) || []).slice(0, 3).join(" · ");
    return `- ${name}：适配 ${ps.audienceFitScore ?? "—"} / 动量 ${ps.momentumScore ?? "—"}${topics ? ` · 样本题 ${topics}` : ""}`;
  });

  const topicLibrary = (snap.topicLibrary as Array<{ title?: string; rationale?: string }>) || [];
  const topicLines = topicLibrary.slice(0, 4).map((t, i) => `${i + 1}. ${String(t.title || "").slice(0, 80)}`);

  const hasLiveData = platforms.some(
    (p) => ((store.collections as Record<string, { items?: unknown[] }>)?.[p]?.items?.length || 0) > 0,
  );

  const brief = [
    `【四平台数据快照 · 近 ${opts.windowDays ?? 30} 天窗口】`,
    hasLiveData ? "（live trendStore 样本已载入，反问须引用具体信号）" : "（样本稀疏，反问仍须结合用户 prompt，热点保守推断）",
    "",
    "— 各平台采集 —",
    ...platformLines,
    "",
    douyinIndex,
    snapLines.length ? ["— 快照平台分数 —", ...snapLines].join("\n") : "",
    topicLines.length ? ["— 快照选题库信号 —", ...topicLines].join("\n") : "",
    "",
    "【反问要求】结合以上数据与用户 prompt：指出 1 条可追热点或搜索词，并问用户能否稳定产出对应内容形态（出镜视频 / 图文笔记 / 长视频讲透）。",
  ]
    .filter(Boolean)
    .join("\n");

  return { brief, storeReadMs: Date.now() - t0, hasLiveData };
}
