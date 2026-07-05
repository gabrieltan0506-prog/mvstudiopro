import { listFreshTrendItems } from "../services/commanderPromptBuilder";
import type { GrowthPlatform } from "../../shared/growth";
import {
  formatTrendHotspotEntry,
  pickRelevantTrendHotspots,
} from "../../shared/platformTrendRelevance";

const DEFAULT_PLATFORMS: GrowthPlatform[] = ["douyin", "xiaohongshu", "bilibili", "kuaishou"];

/**
 * Platform 素材分析：把各平台近期爆款中与本轮选题相关的 2–3 条注入 LLM context。
 */
export async function enrichPlatformAssetAnalysisContext(
  userContext?: string,
  platforms?: GrowthPlatform[],
): Promise<{ context: string; trendMeta: string; coveredPlatforms: GrowthPlatform[] }> {
  const base = String(userContext || "").trim();
  const trendResult = await listFreshTrendItems({
    platforms: platforms?.length ? platforms : DEFAULT_PLATFORMS,
    topN: 12,
    preferFlyLive: true,
  }).catch(() => ({
    entries: [],
    coveredPlatforms: [] as GrowthPlatform[],
    meta: "error",
  }));

  if (!trendResult.entries.length || trendResult.meta === "no_data") {
    return { context: base, trendMeta: trendResult.meta, coveredPlatforms: trendResult.coveredPlatforms };
  }

  const picked = pickRelevantTrendHotspots(trendResult.entries, base, {
    minCount: 2,
    maxCount: 3,
  });

  if (!picked.length) {
    return {
      context: base,
      trendMeta: `${trendResult.meta}; no_relevant_match`,
      coveredPlatforms: trendResult.coveredPlatforms,
    };
  }

  const trendBlock = [
    "【各平台近期热点参考（与本轮选题相关）】",
    "以下 2–3 条经人设/背景筛选，仅供钩子结构与节奏参考；",
    "须结合用户人设改写，禁止字面抄袭标题或正文。",
    "",
    picked.map((entry, i) => `${i + 1}. ${formatTrendHotspotEntry(entry)}`).join("\n"),
  ].join("\n");

  const context = base ? `${base}\n\n${trendBlock}`.slice(0, 12000) : trendBlock.slice(0, 12000);
  return {
    context,
    trendMeta: `${trendResult.meta}; picked=${picked.length}`,
    coveredPlatforms: trendResult.coveredPlatforms,
  };
}
