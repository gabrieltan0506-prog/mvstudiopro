/** OpenRouter 异步视频任务共用提交、轮询、错误清洗与 GCS 镜像。 */

import {
  buildOpenRouterAuthHeaders,
  getOpenRouterApiKey,
} from "./openrouterGptImage2.js";
import {
  isBrowserReadableVideoUrl,
  mirrorSeedanceMp4ToGcsSignedUrl,
} from "./seedanceVideo.js";

const OPENROUTER_BASE = String(
  process.env.OPENROUTER_API_BASE || "https://openrouter.ai/api/v1"
).replace(/\/$/, "");
const OPENROUTER_ORIGIN = new URL(OPENROUTER_BASE).origin;

const POLL_INTERVAL_MS = Math.min(
  Math.max(
    Number(
      process.env.OPENROUTER_VIDEO_POLL_INTERVAL_MS ||
        process.env.OPENROUTER_SEEDANCE_POLL_INTERVAL_MS
    ) || 5_000,
    3_000
  ),
  30_000
);
// 实测 4K 要 968s（2026-08-09），900s 默认线会误杀已扣费的正常任务；默认 1500s、帽 3600s
const MAX_POLL_MS = Math.min(
  Math.max(
    Number(
      process.env.OPENROUTER_VIDEO_POLL_TIMEOUT_MS ||
        process.env.OPENROUTER_SEEDANCE_POLL_TIMEOUT_MS
    ) || 1_500_000,
    120_000
  ),
  3_600_000
);

type OpenRouterVideoJob = {
  id?: string;
  polling_url?: string;
  status?: string;
  unsigned_urls?: string[];
  error?: string | { message?: string };
  message?: string;
};

function jobErrorMessage(job: OpenRouterVideoJob): string {
  if (typeof job.error === "string" && job.error.trim())
    return job.error.trim();
  if (job.error && typeof job.error === "object" && job.error.message) {
    return String(job.error.message).trim();
  }
  return String(job.message || "").trim();
}

function userFacingOpenRouterVideoError(raw: string): string {
  const message = String(raw || "").trim();
  if (!message) return "视频生成失败，请稍后重试";
  if (/api.?key|unauthorized|401|403|鉴权|invalid.*key/i.test(message)) {
    return "视频服务暂不可用，请稍后重试";
  }
  if (/timeout|超时|ETIMEDOUT/i.test(message)) {
    return "视频生成超时，请稍后重试";
  }
  if (/content.?policy|safety|违规|审核/i.test(message)) {
    return "内容未通过审核，请调整提示词或参考图后重试";
  }
  if (/no endpoints available|guardrail|data policy/i.test(message)) {
    return "该成片档暂不可用（服务端配额或线路设置未开放），请稍后重试";
  }
  return message
    .replace(/openrouter/gi, "视频服务")
    .replace(/evolink/gi, "视频服务")
    .replace(/(?:bytedance\/seedance|alibaba\/happyhorse)[^\s,]*/gi, "成片引擎")
    .slice(0, 280);
}

function assertSafePollingUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.origin !== OPENROUTER_ORIGIN) {
    throw new Error("视频服务返回了无效的任务查询地址");
  }
  return url.toString();
}

/** 只给 OpenRouter 自有下载地址附带密钥，禁止把 Authorization 发给第三方 CDN。 */
export function buildOpenRouterVideoDownloadHeaders(
  sourceUrl: string,
  apiKey: string
): Record<string, string> {
  try {
    if (new URL(sourceUrl).origin !== OPENROUTER_ORIGIN) return {};
  } catch {
    return {};
  }
  const headers = buildOpenRouterAuthHeaders(apiKey);
  return {
    Authorization: headers.Authorization || "",
    "HTTP-Referer": headers["HTTP-Referer"] || "",
    "X-Title": headers["X-Title"] || "",
  };
}

export type OpenRouterVideoPollSnapshot =
  | { state: "completed"; sourceUrl: string }
  | { state: "failed"; error: string }
  | { state: "running"; status: string };

/** 单次查询上游视频任务；供异步任务在部署重启后续跑。 */
export async function pollOpenRouterVideoJobOnce(
  pollingUrl: string,
  apiKey: string,
): Promise<OpenRouterVideoPollSnapshot> {
  const safePollingUrl = assertSafePollingUrl(pollingUrl);
  const headers = buildOpenRouterAuthHeaders(apiKey);
  const getHeaders: Record<string, string> = {
    Authorization: headers.Authorization!,
    "HTTP-Referer": headers["HTTP-Referer"] || "",
    "X-Title": headers["X-Title"] || "",
  };
  // 查询接口自身故障（网络 / 限流 / 5xx）≠ 任务失败：当终态会「假失败真退分」。
  // 视作仍在跑，等下一轮；终态只认 2xx 响应体里的 failed/cancelled/expired。
  let response: Response;
  try {
    response = await fetch(safePollingUrl, {
      method: "GET",
      headers: getHeaders,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    return {
      state: "running",
      status: `transient_fetch_error:${e instanceof Error ? e.name : "unknown"}`,
    };
  }
  const json = (await response.json().catch(() => ({}))) as OpenRouterVideoJob;
  if (!response.ok) {
    return { state: "running", status: `transient_http_${response.status}` };
  }
  const status = String(json.status || "").toLowerCase();
  if (status === "completed") {
    const url = (json.unsigned_urls || []).find(
      item => typeof item === "string" && item.trim(),
    );
    if (!url) {
      return { state: "failed", error: "视频生成完成但未返回下载地址" };
    }
    return { state: "completed", sourceUrl: url.trim() };
  }
  if (status === "failed" || status === "cancelled" || status === "expired") {
    return {
      state: "failed",
      error: userFacingOpenRouterVideoError(
        jobErrorMessage(json) || "视频生成失败",
      ),
    };
  }
  return { state: "running", status: status || "processing" };
}

async function pollOpenRouterVideoJob(
  pollingUrl: string,
  apiKey: string
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < MAX_POLL_MS) {
    const snap = await pollOpenRouterVideoJobOnce(pollingUrl, apiKey);
    if (snap.state === "completed") return snap.sourceUrl;
    if (snap.state === "failed") throw new Error(snap.error);
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`视频生成超时（${Math.round(MAX_POLL_MS / 60_000)} 分钟）`);
}

/**
 * 八审 P1-5:提交层直接产出 typed error,不让调用方回头猜文案。
 * rejected=上游明确 4xx 拒绝(确定没建单,可安全回落网关);
 * unknown=网络断/5xx/超时/2xx 缺 id——任务可能已建,禁止回落,转对账。
 */
export class OpenRouterSubmitRejectedError extends Error {
  readonly kind = "rejected";
}
export class OpenRouterSubmitUnknownError extends Error {
  readonly kind = "unknown";
}
export function isOpenRouterSubmitRejected(e: unknown): e is OpenRouterSubmitRejectedError {
  return e instanceof OpenRouterSubmitRejectedError;
}
export function isOpenRouterSubmitUnknown(e: unknown): e is OpenRouterSubmitUnknownError {
  return e instanceof OpenRouterSubmitUnknownError;
}
const OPENROUTER_DEFINITE_REJECT = new Set([400, 401, 403, 404, 413, 415, 422]);

export async function submitOpenRouterVideoJob(
  body: Record<string, unknown>,
): Promise<{
  model: string;
  openRouterJobId: string;
  pollingUrl: string;
  immediateSourceUrl?: string;
  apiKey: string;
}> {
  const apiKey = getOpenRouterApiKey();
  // 配置缺失=确定没打上游,按明确拒绝(回落网关安全)
  if (!apiKey) throw new OpenRouterSubmitRejectedError("视频服务暂不可用，请稍后重试");

  const model = String(body.model || "").trim();
  const prompt = String(body.prompt || "").trim();
  if (!model) throw new OpenRouterSubmitRejectedError("视频服务模型未配置");
  if (!prompt) throw new OpenRouterSubmitRejectedError("请填写视频提示词");

  let createResponse: Response;
  try {
    createResponse = await fetch(`${OPENROUTER_BASE}/videos`, {
      method: "POST",
      headers: buildOpenRouterAuthHeaders(apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    // 网络断/超时:任务可能已在上游建成,结果未知
    throw new OpenRouterSubmitUnknownError(
      `OpenRouter 提交结果未知：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const createJson = (await createResponse
    .json()
    .catch(() => ({}))) as OpenRouterVideoJob;
  if (!createResponse.ok) {
    const detail = `HTTP ${createResponse.status} ${jobErrorMessage(createJson) || ""}`.trim();
    if (OPENROUTER_DEFINITE_REJECT.has(createResponse.status)) {
      throw new OpenRouterSubmitRejectedError(detail);
    }
    // 408/409/425/429/5xx:任务可能已被接受,禁止回落
    throw new OpenRouterSubmitUnknownError(detail);
  }

  const pollingUrlRaw = String(createJson.polling_url || "").trim();
  const openRouterJobId = String(createJson.id || "").trim();
  if (!pollingUrlRaw && !openRouterJobId) {
    // 2xx 但没给任务号:任务可能已建,结果未知
    throw new OpenRouterSubmitUnknownError("OpenRouter 2xx 但未返回 id/polling_url");
  }
  const pollingUrl = assertSafePollingUrl(
    pollingUrlRaw || `${OPENROUTER_BASE}/videos/${encodeURIComponent(openRouterJobId)}`,
  );

  const immediate =
    String(createJson.status || "").toLowerCase() === "completed"
      ? (createJson.unsigned_urls || []).find(
          url => typeof url === "string" && url.trim(),
        )
      : undefined;

  return {
    model,
    openRouterJobId: openRouterJobId || `poll-${Date.now()}`,
    pollingUrl,
    immediateSourceUrl: immediate?.trim() || undefined,
    apiKey,
  };
}

export async function mirrorOpenRouterVideoSourceUrl(
  sourceUrl: string,
  apiKey: string,
  durableStorage?: {
    keyPrefix: string;
    required?: boolean;
  },
): Promise<string> {
  const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(sourceUrl, {
    requestHeaders: buildOpenRouterVideoDownloadHeaders(sourceUrl, apiKey),
    durableStorage,
  });
  if (!isBrowserReadableVideoUrl(videoUrl)) {
    console.error(
      "[openrouterVideo] rejected non-browser-readable video URL",
      String(videoUrl || "").slice(0, 160),
    );
    throw new Error("视频结果地址不可用，请稍后重试");
  }
  return videoUrl;
}

export function isOpenRouterVideoConfigured(): boolean {
  return Boolean(getOpenRouterApiKey());
}

export async function runOpenRouterVideoJob(
  body: Record<string, unknown>,
  options?: {
    durableStorage?: {
      keyPrefix: string;
      required?: boolean;
    };
  }
): Promise<{
  videoUrl: string;
  model: string;
}> {
  const submitted = await submitOpenRouterVideoJob(body);
  const sourceUrl =
    submitted.immediateSourceUrl ||
    (await pollOpenRouterVideoJob(submitted.pollingUrl, submitted.apiKey));
  const videoUrl = await mirrorOpenRouterVideoSourceUrl(
    sourceUrl,
    submitted.apiKey,
    options?.durableStorage,
  );
  return { videoUrl, model: submitted.model };
}

export { POLL_INTERVAL_MS as OPENROUTER_VIDEO_POLL_INTERVAL_MS, MAX_POLL_MS as OPENROUTER_VIDEO_MAX_POLL_MS };
