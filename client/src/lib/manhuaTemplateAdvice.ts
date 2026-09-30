import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";

/** 使用公开编号定位完整模板；实际剧本由现有顾问项目上下文提供。 */
export function buildTemplateAdviceQuestion(card: PublicManhuaViralTemplateCard): string {
  const code = card.publicId.replace(/^mt_/i, "").toUpperCase();
  return `请根据当前集真实剧本，评估模板编号 ${code}（${card.storyPreview?.teaserTitleZh || card.nameZh}）是否适合。结合人物目标、冲突因果、情绪和现有镜头，给出保留、借鉴及不宜套用的具体建议；只给建议，不改稿、不生成媒体、不自动采用。当前剧本证据不足时，请明确缺口。`;
}
