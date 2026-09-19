import { normalizeCanvasVideoModel, type CanvasBlock } from "./canvasTypes";

/** 仅解释 canvasRunBlock 的声音契约，不代替提交时的权限、容量与来源校验。 */
export function canvasAudioCapabilityHint(block: Pick<CanvasBlock, "videoModel" | "seedance25WorkMode">): string {
  const model = normalizeCanvasVideoModel(block.videoModel);
  if (model === "seedance-2.5") {
    if (block.seedance25WorkMode && block.seedance25WorkMode !== "reference_to_video") {
      return "当前模式不会消费本段音轨或母轨，请切换多模态参考模式后出片；原音频保留。";
    }
    return "当前生成档的多模态参考模式可使用已采用的逐段音轨或预混母轨。设置留白或对白避让后，须先预混当前版本。";
  }
  if (["wan-3.0", "seedance-2.0", "seedance-2.0-fast", "seedance-2.0-mini"].includes(model)) {
    return `当前生成档须先把已采用的音轨预混为本段母轨，再用于出片；不会直接发送逐条音轨。母轨参考上限 ${model === "wan-3.0" ? 15 : 30} 秒。`;
  }
  return "当前生成档不支持声音参考；可制作、试听音频，但出片前须切换支持声音参考的生成档，原音频保留。";
}
