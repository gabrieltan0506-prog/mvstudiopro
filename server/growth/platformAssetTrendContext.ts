import { loadFreshPlatformBriefing } from "../services/commanderPromptBuilder";
import type { GrowthPlatform } from "../../shared/growth";

const DEFAULT_PLATFORMS: GrowthPlatform[] = ["douyin", "xiaohongshu", "bilibili", "kuaishou"];

/**
 * Platform 素材分析：把 trendStore 各平台抓取爆款注入 LLM context。
 * 与 Commander / Stage2 同源（commanderPromptBuilder.loadFreshPlatformBriefing）。
 */
export async function enrichPlatformAssetAnalysisContext(
  userContext?: string,
  platforms?: GrowthPlatform[],
): Promise<{ context: string; trendMeta: string; coveredPlatforms: GrowthPlatform[] }> {
  const base = String(userContext || "").trim();
  const briefing = await loadFreshPlatformBriefing({
    platforms: platforms?.length ? platforms : DEFAULT_PLATFORMS,
    topN: 6,
    preferFlyLive: true,
  }).catch(() => ({
    briefingText: "",
    coveredPlatforms: [] as GrowthPlatform[],
    meta: "error",
  }));

  if (!briefing.briefingText.trim() || briefing.meta === "no_data") {
    return { context: base, trendMeta: briefing.meta, coveredPlatforms: briefing.coveredPlatforms };
  }

  const trendBlock = [
    "【各平台近期热点参考】",
    "以下条目来自抖音/小红书/B站/快手等平台近期样本，仅供钩子结构与节奏参考；",
    "须结合用户人设改写，禁止字面抄袭标题或正文。",
    "",
    briefing.briefingText,
  ].join("\n");

  const context = base ? `${base}\n\n${trendBlock}`.slice(0, 12000) : trendBlock.slice(0, 12000);
  return { context, trendMeta: briefing.meta, coveredPlatforms: briefing.coveredPlatforms };
}
