import { gsUriFromSignedGcsUrl } from "@shared/manhuaMultiview";
import { resolveCanvasMaterialUrl } from "./omniCanvasApi";
import { manhuaCreativeAdvisorContextSchema } from "@shared/manhuaCreativeAdvisor";
import type { MusicMvAdvisorSession } from "@shared/canvasMusicMv";

/** 从保存的请求快照重建上下文；刷新恢复不能混入后来改过的歌曲或提示词。 */
export function musicMvAdvisorRequest(session: MusicMvAdvisorSession) {
  const context = manhuaCreativeAdvisorContextSchema.parse({
    projectId: session.projectId,
    seriesTitle: "MV创作",
    episodeIndex: 1,
    episodeTitle: "当前歌曲",
    stage: "storyboard",
    activeStudio: { tool: "musicMv", episodeIndex: 1 },
    videoModel: session.videoModel,
    writerConfirmed: false,
    episodeBody: "",
    assetSummary: "",
    shotSummary: "",
    blockers: [],
    musicMv: session.target,
  });
  return {
    requestId: session.requestId,
    question: session.question,
    rawQuestion: session.question,
    manhuaContext: context,
  };
}

export async function musicMvSourceKey(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  )
    .map(v => v.toString(16).padStart(2, "0"))
    .join("");
}

export function readMvVideoDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const finish = (error?: Error) => {
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      const duration = video.duration;
      video.removeAttribute("src");
      video.load();
      if (error || !Number.isFinite(duration) || duration <= 0)
        reject(error || new Error("视频时长无法读取"));
      else resolve(duration);
    };
    const timer = setTimeout(
      () => finish(new Error("视频时长读取超时")),
      20000
    );
    video.onloadedmetadata = () => finish();
    video.onerror = () => finish(new Error("视频不可播放，请重新选择素材"));
    video.preload = "metadata";
    video.src = url;
  });
}

/** 续签只向现有接口传稳定GCS身份；公开外部地址保持原样，服务端提交另验归属。 */
export async function resolveMusicMvMediaUrl(source: string): Promise<string> {
  const uri = source.startsWith("gs://")
    ? source
    : gsUriFromSignedGcsUrl(source);
  return uri ? resolveCanvasMaterialUrl(uri) : source;
}
