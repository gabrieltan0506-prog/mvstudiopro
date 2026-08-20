/**
 * 百炼官方 HappyHorse 直连(0820 用户拍板:主通道;OpenRouter 网关降级为兜底)。
 *
 * 官方异步契约:POST /api/v1/services/aigc/video-generation/video-synthesis
 * (X-DashScope-Async: enable)→ task_id;GET /api/v1/tasks/{id} 轮询。
 * i2v 入参:input.media=[{type:"first_frame", url}],不支持 ratio(画幅随首帧图);
 * duration 官方支持 3-15 整秒,产品档位仍钳 5/10/15 与网关版一致。
 * 成功产物 output.video_url 是阿里 OSS 短期直链,调用方必须立即镜像 GCS。
 */
import {
  HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION,
  isHomePhotoAnimateDuration,
  isHomePhotoAnimateResolution,
} from "../../shared/homePhotoTools.js";

export const BAILIAN_HAPPYHORSE_I2V_MODEL = "happyhorse-1.1-i2v" as const;

function bailianBase(): string {
  return String(process.env.WAN_OFFICIAL_BASE || "").trim().replace(/\/$/, "");
}

function bailianKey(): string {
  return String(process.env.WAN_OFFICIAL_API_KEY || "").trim();
}

export function isBailianHappyHorseConfigured(): boolean {
  return Boolean(bailianBase() && bailianKey());
}

export function buildBailianHappyHorseSubmitBody(input: {
  prompt: string;
  imageUrl: string;
  duration?: number;
  resolution?: string;
}): Record<string, unknown> {
  const imageUrl = String(input.imageUrl || "").trim();
  if (!imageUrl) throw new Error("Happy Horse 成片需要至少一张首帧参考图");
  const duration = input.duration == null ? 5 : Number(input.duration);
  if (!isHomePhotoAnimateDuration(duration)) {
    throw new Error("照片动起来只支持 5、10 或 15 秒");
  }
  const resolution = input.resolution ?? HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION;
  if (!isHomePhotoAnimateResolution(resolution)) {
    throw new Error("照片动起来只支持 720p 或 1080p");
  }
  return {
    model: BAILIAN_HAPPYHORSE_I2V_MODEL,
    input: {
      prompt: String(input.prompt || "").trim(),
      media: [{ type: "first_frame", url: imageUrl }],
    },
    parameters: {
      resolution: resolution.toUpperCase(),
      duration,
      watermark: false,
    },
  };
}

export async function submitBailianHappyHorseVideo(input: {
  prompt: string;
  imageUrl: string;
  duration?: number;
  resolution?: string;
}): Promise<{ bailianTaskId: string; model: typeof BAILIAN_HAPPYHORSE_I2V_MODEL }> {
  if (!isBailianHappyHorseConfigured()) {
    throw new Error("百炼 HappyHorse 通道未配置");
  }
  const body = buildBailianHappyHorseSubmitBody(input);
  const res = await fetch(
    `${bailianBase()}/api/v1/services/aigc/video-generation/video-synthesis`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bailianKey()}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    output?: { task_id?: string };
    code?: string;
    message?: string;
  };
  const taskId = String(json.output?.task_id || "").trim();
  if (!res.ok || !taskId) {
    throw new Error(
      `百炼 HappyHorse 提交失败 HTTP ${res.status} ${json.code || ""} ${json.message || ""}`.trim(),
    );
  }
  return { bailianTaskId: taskId, model: BAILIAN_HAPPYHORSE_I2V_MODEL };
}

export type BailianHappyHorsePollSnapshot =
  | { state: "completed"; sourceUrl: string }
  | { state: "failed"; error: string }
  | { state: "running"; status: string };

export async function pollBailianHappyHorseOnce(
  taskId: string,
): Promise<BailianHappyHorsePollSnapshot> {
  if (!isBailianHappyHorseConfigured()) {
    return { state: "failed", error: "百炼 HappyHorse 通道暂不可用" };
  }
  let res: Response;
  try {
    res = await fetch(`${bailianBase()}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${bailianKey()}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { state: "running", status: "transient_fetch_error" };
  }
  if (res.status >= 500 || res.status === 429) {
    return { state: "running", status: `transient_http_${res.status}` };
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    // 鉴权/参数被拒不可重试;404 给最终一致性窗口,由任务框架期限治理
    return { state: "failed", error: `HappyHorse 查询被拒 HTTP ${res.status}(不可重试)` };
  }
  if (res.status === 404) {
    return { state: "running", status: "transient_http_404" };
  }
  const json = (await res.json().catch(() => ({}))) as {
    output?: {
      task_status?: string;
      video_url?: string;
      message?: string;
      code?: string;
      results?: Array<{ url?: string; video_url?: string }>;
    };
  };
  const status = String(json.output?.task_status || "").toUpperCase();
  if (status === "SUCCEEDED") {
    const sourceUrl = String(
      json.output?.video_url ||
        json.output?.results?.[0]?.video_url ||
        json.output?.results?.[0]?.url ||
        "",
    ).trim();
    if (!sourceUrl) return { state: "failed", error: "HappyHorse 任务完成但未返回视频" };
    return { state: "completed", sourceUrl };
  }
  if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
    return {
      state: "failed",
      error: String(json.output?.message || json.output?.code || "HappyHorse 生成失败"),
    };
  }
  return { state: "running", status: status.toLowerCase() || "pending" };
}
