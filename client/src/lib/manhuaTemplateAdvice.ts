import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";
import { TEMPLATE_REWRITE_MARKER } from "@shared/manhuaAdvisorRewrite";

/** 公开编号由服务端解析到完整模板；本集正文沿项目上下文传入。 */
export function buildTemplateAdviceQuestion(card: PublicManhuaViralTemplateCard): string {
  const code = card.publicId.replace(/^mt_/i, "").toUpperCase();
  return `${TEMPLATE_REWRITE_MARKER}用模板编号 ${code} 优化当前集完整剧本。把适合本集的节奏、场景调度、人物表演、服化灯光、声音氛围与对白方法落实到正文，只借手法不搬来源故事；保留未改场次，给我原集与优化后整集对比，确认后才套用。`;
}
