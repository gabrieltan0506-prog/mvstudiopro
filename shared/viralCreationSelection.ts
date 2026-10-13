import { XHS_CONTENT_SKILL_ID } from "./xhsContentStrategy.js";
import type { PlatformTopicShortlistItem } from "./platformTopicShortlist.js";
import type { ViralFormat, ViralPlatform } from "./viralCreationMethods.js";

function stableSuffix(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

/** 平台×形式分别成稿；已明确平台的失败项保持原ID，不重新展开成功项。 */
export function planViralExpansions(
  topics: PlatformTopicShortlistItem[],
  platforms: ViralPlatform[],
  formats: ViralFormat[],
): PlatformTopicShortlistItem[] {
  if (!platforms.length || !formats.length) throw new Error("请选择至少一个平台和内容形式");
  const rows = topics.flatMap(topic => {
    if (!topic.skillsUsed.includes(XHS_CONTENT_SKILL_ID) || topic.targetPlatform) return [topic];
    return Array.from(new Set(platforms)).flatMap(platform =>
      Array.from(new Set(formats)).map(format => ({
        ...topic,
        id: `${topic.id.slice(0, 25)}-${stableSuffix(topic.id)}--vc-${platform === "douyin" ? "dy" : "xhs"}-${format === "图文" ? "graphic" : "video"}`,
        sourceTopicId: topic.id,
        targetPlatform: platform,
        formatHint: format,
        dedupeKey: `${stableSuffix(topic.dedupeKey || topic.id)}--${platform}--${format}`,
      })),
    );
  });
  const unique = Array.from(new Map(rows.map(row => [row.id, row])).values());
  if (unique.length > 20) throw new Error("本次最多生成20份稿件，请减少平台、形式或选题");
  return unique;
}
