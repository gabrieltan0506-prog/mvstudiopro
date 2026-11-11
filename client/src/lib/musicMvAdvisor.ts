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
    ...(session.composeEngine === "deep" ? { musicMvComposeEngine: "deep" as const } : {}),
  });
  return {
    requestId: session.requestId,
    question: session.question,
    rawQuestion: session.question,
    manhuaContext: context,
  };
}

/** 服务端明确拒绝（非网络中断）的 tRPC 错误码：此时采用锁定没有保留价值，应解除并允许重试。 */
const ADOPTION_REJECTED_CODES = new Set([
  "PRECONDITION_FAILED",
  "NOT_FOUND",
  "BAD_REQUEST",
  "CONFLICT",
  "FORBIDDEN",
  "UNAUTHORIZED",
]);

/**
 * 采用请求体只从「已成功」的咨询会话取编号：advisorRequestId 必须是产出当前方案的那次咨询，
 * evidenceId 以方案（结果）自带的为准；会话未成功或缺证据编号时直接拒绝，不拿旧请求编号去采用。
 */
export function musicMvAdoptionRequest(
  session: MusicMvAdvisorSession | undefined,
  conceptId: string
): {
  requestId: string;
  conceptId: string;
  advisorRequestId: string;
  evidenceId: string;
} {
  if (!session || session.status !== "succeeded" || !session.proposal)
    throw new Error("当前咨询尚未成功，请重新发起咨询后再采用");
  const evidenceId = session.proposal.evidenceId;
  if (!evidenceId)
    throw new Error("当前方案缺少证据编号，请重新发起咨询后再采用");
  if (!session.proposal.concepts.some(c => c.id === conceptId))
    throw new Error("所选方案不属于当前咨询结果，请刷新后重新选择");
  if (session.adoption && session.adoption.conceptId !== conceptId)
    throw new Error("上一方案采用尚未确认，请先恢复该方案采用");
  return {
    requestId: session.adoption?.requestId || crypto.randomUUID(),
    conceptId,
    advisorRequestId: session.requestId,
    evidenceId,
  };
}

/**
 * 采用失败后的本地处理：服务端明确拒绝时解除采用锁定（清掉 adoption）并给出可操作提示，
 * 让用户可以再点或重新发起咨询；网络中断等不确定结果保留锁定，走「恢复本方案采用」幂等重放。
 */
export function musicMvAdoptionFailure(
  error: unknown,
  session: MusicMvAdvisorSession
): { message: string; session: MusicMvAdvisorSession; rejected: boolean } {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  const base =
    error instanceof Error && error.message
      ? error.message
      : "采用未确认，请恢复原方案采用";
  if (code && ADOPTION_REJECTED_CODES.has(code)) {
    const { adoption: _dropped, ...rest } = session;
    void _dropped;
    const hint =
      code === "PRECONDITION_FAILED" || code === "NOT_FOUND"
        ? "；已解除本次采用锁定，可点「听歌并构思MV」重新发起咨询后再采用"
        : "；已解除本次采用锁定，可重新点击采用";
    return { message: base + hint, session: rest, rejected: true };
  }
  return { message: base, session, rejected: false };
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
