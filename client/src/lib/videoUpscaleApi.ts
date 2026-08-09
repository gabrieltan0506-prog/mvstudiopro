/**
 * 视频高清放大（WaveSpeed 2K/4K）客户端。
 *
 * 异步任务：POST 拿 taskId → 轮询 op=canvasVideoStatus。计费按秒（服务端真源
 * `canvasVideoUpscaleCredits`），前端只用同一共享函数做展示，不自算价。
 * 服务端有「用户+源URL+档位」天然幂等键：断线重发/重复点击不会双扣。
 */
import { withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";

export type VideoUpscaleTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out_pending_reconcile"
  | "reconcile_manual";

export type VideoUpscaleStatusSnapshot = {
  taskId: string;
  status: VideoUpscaleTaskStatus;
  videoUrl?: string;
  error?: string;
  creditsUsed?: number;
  upscaleSourceUrl?: string;
  upscaleTarget?: "2k" | "4k";
};

/** 用户可读的状态文案；对账态必须让用户知道「不会白扣」 */
export function videoUpscaleStatusLabel(status: VideoUpscaleTaskStatus): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "放大中";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败（积分已退回）";
    case "timed_out_pending_reconcile":
      return "超时对账中（不会白扣，稍后自动恢复）";
    case "reconcile_manual":
      return "对账异常，请联系客服（不会白扣）";
  }
}

export function isVideoUpscaleTerminal(status: VideoUpscaleTaskStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "reconcile_manual";
}

/** 读视频真实时长（秒，向上取整）——计费按秒，展示与提交都用真实元数据 */
export function probeVideoDurationSec(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: number | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    try {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.crossOrigin = "anonymous";
      video.onloadedmetadata = () =>
        done(Number.isFinite(video.duration) && video.duration > 0 ? Math.ceil(video.duration) : null);
      video.onerror = () => done(null);
      video.src = url;
      window.setTimeout(() => done(null), 15_000);
    } catch {
      done(null);
    }
  });
}

export async function startVideoUpscale(input: {
  videoUrl: string;
  target: "2k" | "4k";
  durationSec: number;
  /** 漫剧集号：有值走整集批发价；缺省按自由画布零售 ×1.1 */
  episodeIndex?: number;
  sourceResolution?: string;
}): Promise<{ taskId: string; status: VideoUpscaleTaskStatus; creditsUsed: number }> {
  const res = await fetch(withLongJobsFlyDirect("/api/jobs?op=videoUpscale"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      videoUrl: input.videoUrl,
      target: input.target,
      durationSec: input.durationSec,
      episodeIndex: input.episodeIndex,
      sourceResolution: input.sourceResolution || "720p",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    taskId?: string;
    status?: string;
    creditsUsed?: number;
    error?: string;
  };
  if (!res.ok || !json.ok || !json.taskId) {
    throw new Error(json.error || "高清放大任务创建失败");
  }
  return {
    taskId: String(json.taskId),
    status: (json.status as VideoUpscaleTaskStatus) || "queued",
    creditsUsed: Number(json.creditsUsed) || 0,
  };
}

export async function fetchVideoUpscaleStatus(taskId: string): Promise<VideoUpscaleStatusSnapshot> {
  const res = await fetch(
    withLongJobsFlyDirect(`/api/jobs?op=canvasVideoStatus&taskId=${encodeURIComponent(taskId)}`),
    { method: "GET", credentials: "include", cache: "no-store" },
  );
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    status?: string;
    videoUrl?: string;
    error?: string;
    creditsUsed?: number;
    upscaleSourceUrl?: string;
    upscaleTarget?: string;
  };
  if (!res.ok || !json.ok) {
    throw new Error(json.error || "查询放大进度失败");
  }
  return {
    taskId,
    status: (json.status as VideoUpscaleTaskStatus) || "running",
    videoUrl: json.videoUrl ? String(json.videoUrl).trim() : undefined,
    error: json.error,
    creditsUsed: Number(json.creditsUsed) || undefined,
    upscaleSourceUrl: json.upscaleSourceUrl,
    upscaleTarget: json.upscaleTarget === "4k" ? "4k" : json.upscaleTarget === "2k" ? "2k" : undefined,
  };
}
