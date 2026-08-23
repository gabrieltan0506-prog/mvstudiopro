import type { ManhuaViralTemplateBeat } from "@shared/manhuaViralTemplateBank";

/**
 * 逐镜六栏摘要（原生精读独有）。
 *
 * 抽帧链路给不出这些字段，所以全部可选；只拼有值的那几项，
 * 避免出现「景别 undefined」或者连着两个分隔符。
 */
export function formatManhuaTemplateNativeBeatZh(beat: ManhuaViralTemplateBeat): string {
  return [
    beat.endSec != null ? `结束 ${beat.endSec}s` : "",
    beat.shotSizeZh ? `景别 ${beat.shotSizeZh}` : "",
    beat.angleZh ? `机位 ${beat.angleZh}` : "",
    beat.cameraMoveZh ? `运镜 ${beat.cameraMoveZh}` : "",
    beat.lightingZh ? `光影 ${beat.lightingZh}` : "",
    beat.transitionInZh ? `转场 ${beat.transitionInZh}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
