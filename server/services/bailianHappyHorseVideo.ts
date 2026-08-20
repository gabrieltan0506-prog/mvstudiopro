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

/**
 * 六审第8条:提交错误分两类——"明确拒绝"(上游 4xx 回执,确定没建单,可安全回落网关)
 * 与"结果未知"(网络故障/5xx/超时,任务可能已建,回落会重复生成重复烧钱,只能转对账)。
 */
export class BailianHappyHorseSubmitRejectedError extends Error {
  readonly kind = "rejected";
}

export class BailianHappyHorseSubmitUnknownError extends Error {
  readonly kind = "unknown";
}

export function isBailianHappyHorseSubmitRejected(
  error: unknown,
): error is BailianHappyHorseSubmitRejectedError {
  return error instanceof BailianHappyHorseSubmitRejectedError;
}

export function isBailianHappyHorseSubmitUnknown(
  error: unknown,
): error is BailianHappyHorseSubmitUnknownError {
  return error instanceof BailianHappyHorseSubmitUnknownError;
}

export async function submitBailianHappyHorseVideo(input: {
  prompt: string;
  imageUrl: string;
  duration?: number;
  resolution?: string;
}): Promise<{ bailianTaskId: string; model: typeof BAILIAN_HAPPYHORSE_I2V_MODEL }> {
  if (!isBailianHappyHorseConfigured()) {
    // 本地配置缺失=确定没打到上游,按"明确拒绝"回落网关是安全的
    throw new BailianHappyHorseSubmitRejectedError("百炼 HappyHorse 通道未配置");
  }
  const body = buildBailianHappyHorseSubmitBody(input);
  let res: Response;
  try {
    res = await fetch(
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
  } catch (error) {
    throw new BailianHappyHorseSubmitUnknownError(
      `百炼提交结果未知：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const json = (await res.json().catch(() => ({}))) as {
    output?: { task_id?: string };
    request_id?: string;
    code?: string;
    message?: string;
  };
  const taskId = String(json.output?.task_id || "").trim();
  if (res.ok && taskId) {
    return { bailianTaskId: taskId, model: BAILIAN_HAPPYHORSE_I2V_MODEL };
  }
  const detail = [
    `HTTP ${res.status}`,
    json.code,
    json.message,
    json.request_id ? `request_id=${json.request_id}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  /**
   * 七审 P1-5A:只有明确的参数/鉴权类 4xx 才算"确定没建单"。
   * 408(请求超时)/409(冲突)/425/429(限流)任务可能已被接受,按结果未知处理,禁止自动回落。
   */
  if (DEFINITE_REJECTION_STATUS.has(res.status)) {
    throw new BailianHappyHorseSubmitRejectedError(`百炼 HappyHorse 明确拒绝提交：${detail}`);
  }
  throw new BailianHappyHorseSubmitUnknownError(`百炼 HappyHorse 提交结果未知：${detail}`);
}

/**
 * 七审 P1-5B:OpenRouter 网关提交错误的"结果未知"启发式——网络断/超时/5xx
 * 任务可能已建,调用方应转 reconcile_manual 而不是 failTask 假失败真退款。
 */
export function isLikelyUnknownOutcomeSubmitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|aborted|network|fetch failed|socket|ECONN|EPIPE|HTTP 5\d\d|\b50[0-9]\b|502|503|504/i.test(
    msg,
  );
}

const DEFINITE_REJECTION_STATUS = new Set([
  400, // 参数错误
  401, // 鉴权失败
  403, // 无权限
  404, // 提交端点不存在
  413, // 载荷过大
  415, // 媒体类型错误
  422, // 参数语义不合法
]);

export type BailianHappyHorsePollSnapshot =
  | { state: "completed"; sourceUrl: string }
  | { state: "failed"; error: string }
  | { state: "running"; status: string };

export async function pollBailianHappyHorseOnce(
  taskId: string,
): Promise<BailianHappyHorsePollSnapshot> {
  /**
   * 六审第10条:查询侧任何故障都不能冒充"生成失败"——任务在上游照跑照收钱,
   * 误判终态会假失败真退款。只有 2xx 里明确 FAILED/CANCELED/UNKNOWN 才是失败;
   * 配置缺失、鉴权被拒、404、5xx 一律记瞬态,由任务框架的期限+对账治理。
   */
  if (!isBailianHappyHorseConfigured()) {
    return { state: "running", status: "transient_local_config_unavailable" };
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
  if (!res.ok) {
    return { state: "running", status: `transient_query_http_${res.status}` };
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
