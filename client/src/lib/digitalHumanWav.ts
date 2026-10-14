/** 将浏览器解码后的录音保存为保留各原始声道的PCM WAV，不调用外部转码。 */
export function encodeDigitalHumanWav(
  channels: Float32Array[],
  sampleRate: number
): ArrayBuffer {
  const frames = channels[0]?.length || 0;
  if (
    ![1, 2].includes(channels.length) ||
    channels.some(c => c.length !== frames) ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    frames / sampleRate < 3 ||
    frames / sampleRate > 30
  )
    throw new Error("录音须为3–30秒，请重新录制");
  const blockAlign = channels.length * 2;
  const buffer = new ArrayBuffer(44 + frames * blockAlign);
  const view = new DataView(buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * blockAlign, true);
  for (let i = 0; i < frames; i++) {
    for (let channel = 0; channel < channels.length; channel++) {
      const value = channels[channel][i];
      if (!Number.isFinite(value)) throw new Error("录音数据无效，请重新录制");
      const clipped = Math.max(-1, Math.min(1, value));
      view.setInt16(
        44 + i * blockAlign + channel * 2,
        Math.round(clipped * (clipped < 0 ? 32768 : 32767)),
        true
      );
    }
  }
  return buffer;
}
