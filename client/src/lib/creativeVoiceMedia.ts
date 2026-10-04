/** 使用实际AudioContext采样率重采样，不能只把48k音讯标成16k。 */
export function pcm16At16k(samples: Float32Array, sampleRate: number): string {
  const ratio = sampleRate / 16000;
  const count = Math.floor(samples.length / ratio);
  const bytes = new Uint8Array(count * 2); const view = new DataView(bytes.buffer);
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * ratio), end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0; for (let k = start; k < end; k++) sum += samples[k]!;
    const n = Math.max(-1, Math.min(1, sum / (end - start)));
    view.setInt16(i * 2, Math.round(n * (n < 0 ? 32768 : 32767)), true);
  }
  let raw = ""; for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]!);
  return btoa(raw);
}
export function pcmFloat(data: string): Float32Array {
  const raw = atob(data); if (raw.length % 2) throw new Error("音讯长度异常");
  const out = new Float32Array(raw.length / 2);
  for (let i = 0; i < out.length; i++) { let n = raw.charCodeAt(2 * i) | raw.charCodeAt(2 * i + 1) << 8; if (n >= 32768) n -= 65536; out[i] = n / 32768; }
  return out;
}
export function captureVoiceFrame(video: HTMLVideoElement): string | null {
  if (video.readyState < 2 || !video.videoWidth) return null;
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 640 / video.videoWidth, 640 / video.videoHeight);
  canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d"); if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.65).split(",")[1] ?? null;
}
