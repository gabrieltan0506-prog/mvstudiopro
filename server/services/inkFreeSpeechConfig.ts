/** 未完成部署和真实试听前保持关闭，不因上线自动安装模型。 */
export function inkFreeSpeechEnabled() {
  return process.env.INK_FREE_TTS_ENABLED === "1";
}
export const INK_FREE_SPEECH_UNAVAILABLE =
  "合成配音暂未开放，请上传原音、录音或选择无声作品；未领取名额、未提交任务";
