/** OpenRouter 异步视频任务共用提交、轮询、错误清洗与 GCS 镜像。 */

import {
  buildOpenRouterAuthHeaders,
  getOpenRouterApiKey,
} from "./openrouterGptImage2.js";
import { mirrorSeedanceMp4ToGcsSignedUrl } from "./seedanceVideo.js";

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
const MAX_POLL_MS = Math.min(
  Math.max(
    Number(
      process.env.OPENROUTER_VIDEO_POLL_TIMEOUT_MS ||
        process.env.OPENROUTER_SEEDANCE_POLL_TIMEOUT_MS
    ) || 900_000,
    120_000
  ),
  1_200_000
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

async function pollOpenRouterVideoJob(
  pollingUrl: string,
  apiKey: string
): Promise<string> {
  const safePollingUrl = assertSafePollingUrl(pollingUrl);
  const started = Date.now();
  const headers = buildOpenRouterAuthHeaders(apiKey);
  const getHeaders: Record<string, string> = {
    Authorization: headers.Authorization!,
    "HTTP-Referer": headers["HTTP-Referer"] || "",
    "X-Title": headers["X-Title"] || "",
  };

  while (Date.now() - started < MAX_POLL_MS) {
    const response = await fetch(safePollingUrl, {
      method: "GET",
      headers: getHeaders,
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await response
      .json()
      .catch(() => ({}))) as OpenRouterVideoJob;
    if (!response.ok) {
      throw new Error(
        userFacingOpenRouterVideoError(
          jobErrorMessage(json) || `查询失败 (${response.status})`
        )
      );
    }
    const status = String(json.status || "").toLowerCase();
    if (status === "completed") {
      const url = (json.unsigned_urls || []).find(
        item => typeof item === "string" && item.trim()
      );
      if (!url) throw new Error("视频生成完成但未返回下载地址");
      return url.trim();
    }
    if (status === "failed" || status === "cancelled" || status === "expired") {
      throw new Error(
        userFacingOpenRouterVideoError(jobErrorMessage(json) || "视频生成失败")
      );
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`视频生成超时（${Math.round(MAX_POLL_MS / 60_000)} 分钟）`);
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
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) throw new Error("视频服务暂不可用，请稍后重试");

  const model = String(body.model || "").trim();
  const prompt = String(body.prompt || "").trim();
  if (!model) throw new Error("视频服务模型未配置");
  if (!prompt) throw new Error("请填写视频提示词");

  const createResponse = await fetch(`${OPENROUTER_BASE}/videos`, {
    method: "POST",
    headers: buildOpenRouterAuthHeaders(apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const createJson = (await createResponse
    .json()
    .catch(() => ({}))) as OpenRouterVideoJob;
  if (!createResponse.ok) {
    throw new Error(
      userFacingOpenRouterVideoError(
        jobErrorMessage(createJson) || `创建任务失败 (${createResponse.status})`
      )
    );
  }

  const pollingUrl = String(createJson.polling_url || "").trim();
  const jobId = String(createJson.id || "").trim();
  if (!pollingUrl && !jobId) throw new Error("视频服务未返回任务信息");

  const immediate =
    String(createJson.status || "").toLowerCase() === "completed"
      ? (createJson.unsigned_urls || []).find(
          url => typeof url === "string" && url.trim()
        )
      : undefined;
  const sourceUrl = immediate
    ? immediate.trim()
    : await pollOpenRouterVideoJob(
        pollingUrl || `${OPENROUTER_BASE}/videos/${encodeURIComponent(jobId)}`,
        apiKey
      );

  const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(sourceUrl, {
    requestHeaders: buildOpenRouterVideoDownloadHeaders(sourceUrl, apiKey),
    durableStorage: options?.durableStorage,
  });
  return { videoUrl, model };
}
