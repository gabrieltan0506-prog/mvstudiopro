/**
 * OpenRouter MiniMax H3 / Hailuo 3（POST /api/v1/videos + poll）。
 * 不走 EvoLink；密钥：OPENROUTER_API_KEY。
 */

import {
  clampHailuoOpenRouterDuration,
  HAILUO_OPENROUTER_MODEL_ID,
  HAILUO_REFERENCE_MAX,
  type HailuoOpenRouterResolution,
  normalizeHailuoOpenRouterAspectRatio,
  normalizeHailuoOpenRouterResolution,
} from "../../shared/hailuoOpenRouterModels.js";
import { buildOpenRouterAuthHeaders, getOpenRouterApiKey } from "./openrouterGptImage2.js";
import { mirrorSeedanceMp4ToGcsSignedUrl } from "./seedanceVideo.js";

const OPENROUTER_BASE = String(process.env.OPENROUTER_API_BASE || "https://openrouter.ai/api/v1").replace(
  /\/$/,
  "",
);

const POLL_INTERVAL_MS = Math.min(
  Math.max(Number(process.env.OPENROUTER_HAILUO_POLL_INTERVAL_MS) || 5_000, 3_000),
  30_000,
);
const MAX_POLL_MS = Math.min(
  Math.max(Number(process.env.OPENROUTER_HAILUO_POLL_TIMEOUT_MS) || 900_000, 120_000),
  1_200_000,
);

export function isOpenRouterHailuoConfigured(): boolean {
  return Boolean(getOpenRouterApiKey());
}

type OpenRouterVideoJob = {
  id?: string;
  polling_url?: string;
  status?: string;
  unsigned_urls?: string[];
  error?: string | { message?: string };
  message?: string;
};

function jobErrorMessage(job: OpenRouterVideoJob): string {
  if (typeof job.error === "string" && job.error.trim()) return job.error.trim();
  if (job.error && typeof job.error === "object" && job.error.message) {
    return String(job.error.message).trim();
  }
  return String(job.message || "").trim();
}

function userFacingHailuoError(raw: string): string {
  const m = String(raw || "").trim();
  if (!m) return "视频生成失败，请稍后重试";
  if (/api.?key|unauthorized|401|403|鉴权|invalid.*key/i.test(m)) {
    return "视频服务暂不可用，请稍后重试";
  }
  if (/timeout|超时|ETIMEDOUT/i.test(m)) {
    return "视频生成超时，请稍后重试";
  }
  if (/content.?policy|safety|违规|审核/i.test(m)) {
    return "内容未通过审核，请调整提示词或参考图后重试";
  }
  /**
   * H3 在上游只有一家 provider，账号的数据政策 / guardrail 一挡就整档不可用，
   * 返回 `No endpoints available matching your guardrail restrictions and data policy`。
   * 与提示词无关，也不该把上游的设置链接给用户看。
   */
  if (/no endpoints available|guardrail|data policy/i.test(m)) {
    return "该成片档暂不可用（服务端配额或线路设置未开放），请改用其他成片档或稍后重试";
  }
  return m
    .replace(/openrouter/gi, "视频服务")
    .replace(/evolink/gi, "视频服务")
    .replace(/minimax\/hailuo[^\s,]*/gi, "成片引擎")
    .replace(/hailuo-?3/gi, "成片引擎")
    .slice(0, 280);
}

export function buildOpenRouterHailuoSubmitBody(input: {
  prompt: string;
  imageUrl?: string;
  imageUrls?: string[];
  aspectRatio?: string;
  duration?: number;
  /** 768p 草稿 / 2K 高清；缺省或认不出一律 768p */
  resolution?: string;
  generateAudio?: boolean;
}): Record<string, unknown> {
  const duration = clampHailuoOpenRouterDuration(input.duration);
  const resolution = normalizeHailuoOpenRouterResolution(input.resolution);
  const aspect_ratio = normalizeHailuoOpenRouterAspectRatio(input.aspectRatio);
  const images = [
    ...(input.imageUrls || []).map((u) => String(u || "").trim()).filter(Boolean),
    ...(String(input.imageUrl || "").trim() ? [String(input.imageUrl).trim()] : []),
  ];
  const uniqueImages = Array.from(new Set(images)).slice(0, HAILUO_REFERENCE_MAX.image);

  const body: Record<string, unknown> = {
    model: HAILUO_OPENROUTER_MODEL_ID,
    prompt: String(input.prompt || "").trim(),
    duration,
    resolution,
    aspect_ratio,
    generate_audio: input.generateAudio !== false,
  };

  if (uniqueImages.length === 1) {
    body.frame_images = [
      {
        type: "image_url",
        image_url: { url: uniqueImages[0] },
        frame_type: "first_frame",
      },
    ];
  } else if (uniqueImages.length > 1) {
    // 首张作起幅；其余作参考图（H3 不认 Seedance 的音/视频参考）
    body.frame_images = [
      {
        type: "image_url",
        image_url: { url: uniqueImages[0] },
        frame_type: "first_frame",
      },
    ];
    body.input_references = uniqueImages.slice(1).map((url) => ({
      type: "image_url",
      image_url: { url },
    }));
  }

  return body;
}

async function pollOpenRouterVideoJob(pollingUrl: string, apiKey: string): Promise<string> {
  const started = Date.now();
  const headers = buildOpenRouterAuthHeaders(apiKey);
  const getHeaders: Record<string, string> = {
    Authorization: headers.Authorization!,
    "HTTP-Referer": headers["HTTP-Referer"] || "",
    "X-Title": headers["X-Title"] || "",
  };

  while (Date.now() - started < MAX_POLL_MS) {
    const r = await fetch(pollingUrl, {
      method: "GET",
      headers: getHeaders,
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await r.json().catch(() => ({}))) as OpenRouterVideoJob;
    if (!r.ok) {
      throw new Error(userFacingHailuoError(jobErrorMessage(json) || `查询失败 (${r.status})`));
    }
    const status = String(json.status || "").toLowerCase();
    if (status === "completed") {
      const url = (json.unsigned_urls || []).find((u) => typeof u === "string" && u.trim());
      if (!url) throw new Error("视频生成完成但未返回下载地址");
      return url.trim();
    }
    if (status === "failed" || status === "cancelled" || status === "expired") {
      throw new Error(userFacingHailuoError(jobErrorMessage(json) || "视频生成失败"));
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`视频生成超时（${Math.round(MAX_POLL_MS / 60_000)} 分钟）`);
}

export type OpenRouterHailuoRunInput = {
  prompt: string;
  imageUrl?: string;
  imageUrls?: string[];
  aspectRatio?: string;
  duration?: number;
  /** 768p 草稿 / 2K 高清；缺省或认不出一律 768p */
  resolution?: string;
  generateAudio?: boolean;
};

export async function runOpenRouterHailuoVideo(input: OpenRouterHailuoRunInput): Promise<{
  videoUrl: string;
  model: string;
  provider: "openrouter";
  version: "hailuo-3";
  resolution: HailuoOpenRouterResolution;
}> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error("视频服务暂不可用，请稍后重试");
  }

  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("请填写视频提示词");

  const body = buildOpenRouterHailuoSubmitBody(input);
  const model = String(body.model);
  const resolution = body.resolution as HailuoOpenRouterResolution;

  const createRes = await fetch(`${OPENROUTER_BASE}/videos`, {
    method: "POST",
    headers: buildOpenRouterAuthHeaders(apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const createJson = (await createRes.json().catch(() => ({}))) as OpenRouterVideoJob;
  if (!createRes.ok) {
    throw new Error(
      userFacingHailuoError(jobErrorMessage(createJson) || `创建任务失败 (${createRes.status})`),
    );
  }

  const pollingUrl = String(createJson.polling_url || "").trim();
  const jobId = String(createJson.id || "").trim();
  if (!pollingUrl && !jobId) {
    throw new Error("视频服务未返回任务信息");
  }
  const pollUrl = pollingUrl || `${OPENROUTER_BASE}/videos/${encodeURIComponent(jobId)}`;

  const immediate =
    String(createJson.status || "").toLowerCase() === "completed"
      ? (createJson.unsigned_urls || []).find((u) => typeof u === "string" && u.trim())
      : undefined;
  const sourceUrl = immediate
    ? immediate.trim()
    : await pollOpenRouterVideoJob(pollUrl, apiKey);

  const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(sourceUrl);
  return {
    videoUrl,
    model,
    provider: "openrouter",
    version: "hailuo-3",
    resolution,
  };
}
