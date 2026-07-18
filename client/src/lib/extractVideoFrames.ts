/**
 * 浏览器端从已上传视频 URL 抽帧（用户本地解码，不经 Fly/Vercel 抓 YouTube）。
 */

export type ExtractedVideoFrame = {
  tSec: number;
  dataUrl: string;
  mimeType: "image/jpeg";
};

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const onError = () => reject(new Error("video_load_failed"));
    video.addEventListener("error", onError, { once: true });
    video.addEventListener(
      "loadedmetadata",
      () => {
        video.removeEventListener("error", onError);
        resolve(video);
      },
      { once: true },
    );
    video.src = url;
  });
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    const onError = () => reject(new Error("video_seek_failed"));
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    try {
      video.currentTime = Math.min(Math.max(0, t), Math.max(0, video.duration - 0.05));
    } catch (e) {
      reject(e);
    }
  });
}

export async function extractVideoFramesFromUrl(
  videoUrl: string,
  opts?: {
    maxFrames?: number;
    intervalSec?: number;
    maxDurationSec?: number;
    maxWidth?: number;
    jpegQuality?: number;
  },
): Promise<{ frames: ExtractedVideoFrame[]; durationSec: number }> {
  const maxFrames = Math.max(4, Math.min(32, opts?.maxFrames ?? 16));
  const intervalSec = Math.max(0.5, opts?.intervalSec ?? 2);
  const maxDurationSec = Math.max(5, opts?.maxDurationSec ?? 120);
  const maxWidth = opts?.maxWidth ?? 768;
  const quality = opts?.jpegQuality ?? 0.82;

  const video = await loadVideo(videoUrl);
  const durationSec = Math.min(Number(video.duration) || 0, maxDurationSec);
  if (!(durationSec > 0.2)) throw new Error("video_duration_invalid");

  const times: number[] = [];
  for (let t = 0; t < durationSec && times.length < maxFrames; t += intervalSec) {
    times.push(Number(t.toFixed(2)));
  }
  if (times[times.length - 1] < durationSec - 0.15 && times.length < maxFrames) {
    times.push(Number((durationSec - 0.05).toFixed(2)));
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_2d_unavailable");

  const frames: ExtractedVideoFrame[] = [];
  for (const t of times) {
    await seek(video, t);
    const vw = video.videoWidth || 720;
    const vh = video.videoHeight || 1280;
    const scale = Math.min(1, maxWidth / vw);
    canvas.width = Math.max(1, Math.round(vw * scale));
    canvas.height = Math.max(1, Math.round(vh * scale));
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    frames.push({ tSec: t, dataUrl, mimeType: "image/jpeg" });
  }

  video.removeAttribute("src");
  video.load();
  return { frames, durationSec };
}

/** 抽取成片末 N 帧（短剧段间接力 / Seedance 参考） */
export async function extractVideoTailFramesFromUrl(
  videoUrl: string,
  opts?: {
    frameCount?: number;
    /** 末段采样窗口（秒），默认取片尾约 1.2s */
    tailWindowSec?: number;
    maxWidth?: number;
    jpegQuality?: number;
  },
): Promise<{ frames: ExtractedVideoFrame[]; durationSec: number }> {
  const frameCount = Math.max(1, Math.min(6, opts?.frameCount ?? 3));
  const tailWindowSec = Math.max(0.35, opts?.tailWindowSec ?? 1.2);
  const maxWidth = opts?.maxWidth ?? 768;
  const quality = opts?.jpegQuality ?? 0.82;

  const video = await loadVideo(videoUrl);
  const durationSec = Number(video.duration) || 0;
  if (!(durationSec > 0.2)) throw new Error("video_duration_invalid");

  const start = Math.max(0, durationSec - tailWindowSec);
  const times: number[] = [];
  if (frameCount === 1) {
    times.push(Number((durationSec - 0.05).toFixed(2)));
  } else {
    for (let i = 0; i < frameCount; i++) {
      const t = start + ((durationSec - 0.05 - start) * i) / (frameCount - 1);
      times.push(Number(Math.min(durationSec - 0.05, Math.max(0, t)).toFixed(2)));
    }
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_2d_unavailable");

  const frames: ExtractedVideoFrame[] = [];
  for (const t of times) {
    await seek(video, t);
    const vw = video.videoWidth || 720;
    const vh = video.videoHeight || 1280;
    const scale = Math.min(1, maxWidth / vw);
    canvas.width = Math.max(1, Math.round(vw * scale));
    canvas.height = Math.max(1, Math.round(vh * scale));
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push({ tSec: t, dataUrl: canvas.toDataURL("image/jpeg", quality), mimeType: "image/jpeg" });
  }

  video.removeAttribute("src");
  video.load();
  return { frames, durationSec };
}
