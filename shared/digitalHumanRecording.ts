/** 与既有本人录音克隆服务保持一致；时长以服务端真实解码复核为准。 */
export const DIGITAL_HUMAN_RECORDING_MIN_SEC = 3;
export const DIGITAL_HUMAN_RECORDING_MAX_SEC = 30;
export const DIGITAL_HUMAN_RECORDING_MAX_BYTES = 20 * 1024 * 1024;
export const DIGITAL_HUMAN_RECORDING_READ_TEXT =
  "你好，这是我的声音测试。我希望保留自己说话时的音色、语速和自然停顿。接下来，我会用这段声音介绍想法，分享经验，也讲述日常生活中的故事。";
export function assertDigitalHumanRecording(input: {
  bytes: number;
  durationSec: number;
  fileName: string;
}): void {
  if (
    !Number.isFinite(input.bytes) ||
    input.bytes <= 0 ||
    input.bytes > DIGITAL_HUMAN_RECORDING_MAX_BYTES
  )
    throw new Error("参考录音须大于0且不超过20MB");
  if (!/\.(mp3|wav|m4a|aac)$/i.test(input.fileName))
    throw new Error("请使用MP3、WAV、M4A或AAC录音");
  if (
    !Number.isFinite(input.durationSec) ||
    input.durationSec < DIGITAL_HUMAN_RECORDING_MIN_SEC ||
    input.durationSec > DIGITAL_HUMAN_RECORDING_MAX_SEC
  )
    throw new Error("参考录音须为3–30秒清晰人声，建议录制15–20秒");
}
