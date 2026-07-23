/**
 * OpenRouter Seedance 2.0 / 2.0-fast（POST /api/v1/videos + poll）。
 * 不走 EvoLink；密钥：OPENROUTER_API_KEY。
 */

import {
  clampSeedanceOpenRouterDuration,
  normalizeSeedanceOpenRouterAspectRatio,
  normalizeSeedanceOpenRouterQuality,
  resolveSeedanceOpenRouterModelId,
  type SeedanceOpenRouterVariant,
} from "../../shared/seedanceOpenRouterModels.js";
import { buildOpenRouterAuthHeaders, getOpenRouterApiKey } from "./openrouterGptImage2.js";
import { mirrorSeedanceMp4ToGcsSignedUrl } from "./seedanceVideo.js";

const OPENROUTER_BASE = String(process.env.OPENROUTER_API_BASE || "https://openrouter.ai/api/v1").replace(
  /\/$/,
  "",
);

const POLL_INTERVAL_MS = Math.min(
  Math.max(Number(process.env.OPENROUTER_SEEDANCE_POLL_INTERVAL_MS) || 5_000, 3_000),
  30_000,
);
const MAX_POLL_MS = Math.min(
  Math.max(Number(process.env.OPENROUTER_SEEDANCE_POLL_TIMEOUT_MS) || 900_000, 120_000),
  1_200_000,
);

export function isOpenRouterSeedanceConfigured(): boolean {
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

function userFacingSeedanceError(raw: string): string {
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
  // 去掉供应商 / 路由名
  return m
    .replace(/openrouter/gi, "视频服务")
    .replace(/evolink/gi, "视频服务")
    .replace(/bytedance\/seedance[^\s,]*/gi, "成片引擎")
    .slice(0, 280);
}

export function buildOpenRouterSeedanceSubmitBody(input: {
  variant: SeedanceOpenRouterVariant;
  prompt: string;
  imageUrl?: string;
  imageUrls?: string[];
  /** 角色声线参考 mp3（最多 3；进 input_references） */
  audioUrls?: string[];
  aspectRatio?: string;
  duration?: number;
  quality?: string;
  generateAudio?: boolean;
}): Record<string, unknown> {
  const model = resolveSeedanceOpenRouterModelId(input.variant);
  const duration = clampSeedanceOpenRouterDuration(input.duration);
  const resolution = normalizeSeedanceOpenRouterQuality(input.variant, input.quality);
  const aspect_ratio = normalizeSeedanceOpenRouterAspectRatio(input.aspectRatio);
  const images = [
    ...(input.imageUrls || []).map((u) => String(u || "").trim()).filter(Boolean),
    ...(String(input.imageUrl || "").trim() ? [String(input.imageUrl).trim()] : []),
  ];
  const uniqueImages = Array.from(new Set(images));
  const audioUrls = Array.from(
    new Set((input.audioUrls || []).map((u) => String(u || "").trim()).filter(Boolean)),
  ).slice(0, 3);

  const body: Record<string, unknown> = {
    model,
    prompt: String(input.prompt || "").trim(),
    duration,
    resolution,
    aspect_ratio,
    generate_audio: input.generateAudio !== false,
  };

  const inputReferences: Array<Record<string, unknown>> = [];
  if (uniqueImages.length === 1 && !audioUrls.length) {
    // 单图且无声线参考：走首帧 I2V
    body.frame_images = [
      {
        type: "image_url",
        image_url: { url: uniqueImages[0] },
        frame_type: "first_frame",
      },
    ];
  } else if (uniqueImages.length === 1 && audioUrls.length) {
    // 有声线参考时改走 reference（首帧图 + 参考音）
    inputReferences.push({
      type: "image_url",
      image_url: { url: uniqueImages[0] },
    });
  } else if (uniqueImages.length > 1) {
    for (const url of uniqueImages.slice(0, 4)) {
      inputReferences.push({
        type: "image_url",
        image_url: { url },
      });
    }
  }
  for (const url of audioUrls) {
    inputReferences.push({
      type: "audio_url",
      audio_url: { url },
    });
  }
  if (inputReferences.length) {
    body.input_references = inputReferences;
  }

  return body;
}

async function pollOpenRouterVideoJob(
  pollingUrl: string,
  apiKey: string,
): Promise<string> {
  const started = Date.now();
  const headers = buildOpenRouterAuthHeaders(apiKey);
  // GET 轮询不需要 Content-Type
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
      throw new Error(userFacingSeedanceError(jobErrorMessage(json) || `查询失败 (${r.status})`));
    }
    const status = String(json.status || "").toLowerCase();
    if (status === "completed") {
      const url = (json.unsigned_urls || []).find((u) => typeof u === "string" && u.trim());
      if (!url) throw new Error("视频生成完成但未返回下载地址");
      return url.trim();
    }
    if (status === "failed" || status === "cancelled" || status === "expired") {
      throw new Error(userFacingSeedanceError(jobErrorMessage(json) || "视频生成失败"));
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`视频生成超时（${Math.round(MAX_POLL_MS / 60_000)} 分钟）`);
}

export type OpenRouterSeedanceRunInput = {
  prompt: string;
  imageUrl?: string;
  imageUrls?: string[];
  audioUrls?: string[];
  aspectRatio?: string;
  duration?: number;
  quality?: string;
  generateAudio?: boolean;
  version?: SeedanceOpenRouterVariant | string;
};

export async function runOpenRouterSeedanceVideo(input: OpenRouterSeedanceRunInput): Promise<{
  videoUrl: string;
  model: string;
  provider: "openrouter";
  version: SeedanceOpenRouterVariant;
}> {
  const variant: SeedanceOpenRouterVariant =
    String(input.version || "2.0").trim().toLowerCase() === "2.0-fast" ||
    String(input.version || "").trim().toLowerCase() === "fast"
      ? "2.0-fast"
      : "2.0";

  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error("视频服务暂不可用，请稍后重试");
  }

  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("请填写视频提示词");

  const body = buildOpenRouterSeedanceSubmitBody({
    variant,
    prompt,
    imageUrl: input.imageUrl,
    imageUrls: input.imageUrls,
    audioUrls: input.audioUrls,
    aspectRatio: input.aspectRatio,
    duration: input.duration,
    quality: input.quality,
    generateAudio: input.generateAudio,
  });
  const model = String(body.model);

  const createRes = await fetch(`${OPENROUTER_BASE}/videos`, {
    method: "POST",
    headers: buildOpenRouterAuthHeaders(apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const createJson = (await createRes.json().catch(() => ({}))) as OpenRouterVideoJob;
  if (!createRes.ok) {
    throw new Error(
      userFacingSeedanceError(
        jobErrorMessage(createJson) || `创建任务失败 (${createRes.status})`,
      ),
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
  return { videoUrl, model, provider: "openrouter", version: variant };
}
