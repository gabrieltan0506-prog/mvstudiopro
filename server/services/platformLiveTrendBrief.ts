import type { GrowthPlatform } from "@shared/growth";
import { readTrendStoreForPlatforms } from "../growth/trendStore.js";
import { buildTrendEngagementVisualBriefForPlatform } from "./trendEngagementVisualBrief.js";

const DEFAULT_PLATFORMS: GrowthPlatform[] = ["douyin", "xiaohongshu", "bilibili", "kuaishou"];

/** 素材优化路径：只读 trendStore 近期 live 样本，禁止 mock snapshot。 */
export async function buildPlatformLiveTrendBriefForOptimize(options?: {
  windowDays?: number;
  platforms?: GrowthPlatform[];
}): Promise<string> {
  const windowDays = Math.max(3, Math.min(15, options?.windowDays ?? 7));
  const platforms = options?.platforms?.length ? options.platforms : DEFAULT_PLATFORMS;

  const store = await readTrendStoreForPlatforms(platforms, {
    preferDerivedFiles: true,
    preferFlyLive: true,
  });

  const sections: string[] = [];
  for (const platform of platforms) {
    const items = store.collections?.[platform]?.items ?? [];
    const brief = buildTrendEngagementVisualBriefForPlatform({
      platformKey: platform,
      items,
      windowDaysFallback: windowDays,
      linesMax: 3,
    });
    if (brief.trim()) sections.push(brief.trim());
  }

  if (!sections.length) {
    return (
      `【近期平台热点 · trendStore ${windowDays} 天窗口】` +
      `暂无近期 live 样本。请仅基于上传素材视觉分析与用户 brief 优化，` +
      `禁止编造热搜、禁止使用过期模板或 growth snapshot 套话。`
    );
  }

  return (
    `【近期平台热点 · trendStore live ${windowDays} 天窗口 · 须标注来源平台】\n` +
    `${sections.join("\n\n")}\n\n` +
    `说明：以上仅为近期样本标题参考，禁止照抄字面；优化须优先绑定用户上传素材。`
  );
}
