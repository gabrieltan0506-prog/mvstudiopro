import type { PlatformTrendCollection } from "./trendCollector";
import { getTrendItemAgeDays } from "./trendWindow";

export type GrowthStatusProjection = {
  collectedAt: string;
  windowItems15d: number;
  windowItems30d: number;
  hotTopic: string;
};

/** 写入已加载的平台数据时生成小摘要；状态查询不得重新扫描/排序全库。 */
export function buildGrowthStatusProjection(collection: PlatformTrendCollection): GrowthStatusProjection {
  let dated15 = 0, dated30 = 0, undated = 0;
  let hotTopic = "", topScore = -Infinity;
  for (const item of collection.items) {
    const age = getTrendItemAgeDays(item.publishedAt);
    if (age === undefined) undated++;
    else {
      if (age <= 15) dated15++;
      if (age <= 30) dated30++;
    }
    const score = (item.likes || 0) + (item.comments || 0) * 3 + (item.shares || 0) * 5 + Math.round((item.views || 0) / 1000);
    if (item.title && score > topScore) { topScore = score; hotTopic = item.title; }
  }
  return { collectedAt: collection.collectedAt, hotTopic,
    windowItems15d: dated15 >= 8 ? dated15 : dated15 + undated,
    windowItems30d: dated30 + undated };
}
