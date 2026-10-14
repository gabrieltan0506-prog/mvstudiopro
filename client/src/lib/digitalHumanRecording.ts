import { assertDigitalHumanRecording } from "@shared/digitalHumanRecording";
/** 上传前只在浏览器读取本地文件时长；未确认的录音不会传给声线服务。 */
export function inspectDigitalHumanRecording(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file),
      audio = document.createElement("audio");
    let settled = false;
    const done = (duration?: number, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve(duration!);
    };
    const timer = setTimeout(
      () =>
        done(
          undefined,
          new Error("读取录音时长超时，请换用MP3、WAV、M4A或AAC")
        ),
      15000
    );
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      try {
        assertDigitalHumanRecording({
          bytes: file.size,
          durationSec: audio.duration,
          fileName: file.name,
        });
        done(audio.duration);
      } catch (e) {
        done(undefined, e);
      }
    };
    audio.onerror = () =>
      done(undefined, new Error("无法播放这份录音，请重新录制或导出"));
    audio.src = url;
  });
}
