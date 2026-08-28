import type { ManhuaViralTemplateBeat } from "@shared/manhuaViralTemplateBank";

/** 原生逐镜证据摘要；历史抽帧卡没有这些字段，因此只显示真实存在的值。 */
export function formatManhuaTemplateNativeBeatZh(beat: ManhuaViralTemplateBeat): string {
  return [
    beat.endSec != null ? `结束 ${beat.endSec}s` : "",
    beat.unitTypeZh ? `单元 ${beat.unitTypeZh}` : "",
    beat.shotSizeZh ? `景别 ${beat.shotSizeZh}` : "",
    beat.angleZh ? `机位 ${beat.angleZh}` : "",
    beat.compositionZh ? `构图 ${beat.compositionZh}` : "",
    beat.cameraMoveZh ? `运镜 ${beat.cameraMoveZh}` : "",
    beat.blockingZh ? `站位调度 ${beat.blockingZh}` : "",
    beat.bodyActionZh ? `整体动作 ${beat.bodyActionZh}` : "",
    beat.limbPropActionZh ? `四肢/道具 ${beat.limbPropActionZh}` : "",
    beat.microExpressionZh ? `微表情 ${beat.microExpressionZh}` : "",
    beat.gazeBreathZh ? `视线/呼吸 ${beat.gazeBreathZh}` : "",
    beat.relationshipReactionZh ? `关系反应 ${beat.relationshipReactionZh}` : "",
    beat.lightingZh ? `光影 ${beat.lightingZh}` : "",
    beat.transitionInZh ? `转场 ${beat.transitionInZh}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
