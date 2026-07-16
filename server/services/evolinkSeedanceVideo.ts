import {
  SEEDANCE_25_COMING_SOON_LABEL_EN,
  SEEDANCE_25_PUBLICLY_ENABLED,
  clampSeedanceDuration,
  inferSeedanceMode,
  resolveSeedanceModelId,
  type SeedanceEvolinkMode,
  type SeedanceEvolinkVersion,
} from "../../shared/seedanceEvolinkModels.js";
import { mirrorSeedanceMp4ToGcsSignedUrl } from "./seedanceVideo.js";

const EVOLINK_BASE = String(process.env.EVOLINK_API_BASE || "https://api.evolink.ai").replace(/\/$/, "");
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_MS = Math.min(
  Math.max(Number(process.env.EVOLINK_SEEDANCE_POLL_TIMEOUT_MS) || 900_000, 120_000),
  1_200_000,
);

export function isEvolinkSeedanceConfigured(): boolean {
  return Boolean(String(process.env.EVOLINK_API_KEY || "").trim());
}

/** 产品未开放；仅 SEEDANCE_25_ENABLED=1 时可走真实请求（联调）。 */
export function isSeedance25Enabled(): boolean {
  if (SEEDANCE_25_PUBLICLY_ENABLED) return true;
  return /^(1|true|yes)$/i.test(String(process.env.SEEDANCE_25_ENABLED || ""));
}

function normalizeQuality20(raw: unknown): "480p" | "720p" | "1080p" {
  const q = String(raw || "720p").trim().toLowerCase();
  if (q === "480p" || q === "1080p") return q;
  return "720p";
}

function normalizeQuality25(raw: unknown): "480p" | "720p" {
  const q = String(raw || "720p").trim().toLowerCase();
  return q === "480p" ? "480p" : "720p";
}

type EvolinkVideoTask = {
  id?: string;
  status?: string;
  progress?: number;
  results?: string[];
  result?: { video_url?: string; thumbnail_url?: string };
  output?: { video_url?: string; url?: string };
  error?: { code?: string; message?: string };
  message?: string;
};

function extractEvolinkVideoUrl(task: EvolinkVideoTask): string {
  const fromResults = (task.results || []).find((u) => typeof u === "string" && /^https?:\/\//i.test(u));
  if (fromResults) return fromResults.trim();
  const nested =
    (typeof task.result?.video_url === "string" && task.result.video_url) ||
    (typeof task.output?.video_url === "string" && task.output.video_url) ||
    (typeof task.output?.url === "string" && task.output.url) ||
    "";
  return nested.trim();
}

async function pollEvolinkVideoTask(taskId: string, label: string): Promise<string> {
  const apiKey = String(process.env.EVOLINK_API_KEY || "").trim();
  if (!apiKey) throw new Error("EVOLINK_API_KEY 未配置");

  const started = Date.now();
  while (Date.now() - started < MAX_POLL_MS) {
    const r = await fetch(`${EVOLINK_BASE}/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await r.json().catch(() => ({}))) as EvolinkVideoTask;
    if (!r.ok) {
      throw new Error(json.error?.message || `EvoLink 任务查询失败 (${r.status})`);
    }

    const status = String(json.status || "").toLowerCase();
    if (status === "completed" || status === "succeeded" || status === "success") {
      const url = extractEvolinkVideoUrl(json);
      if (!url) throw new Error(`${label} 任务完成但未返回视频 URL`);
      return url;
    }
    if (status === "failed" || status === "cancelled") {
      throw new Error(json.error?.message || `${label} 视频生成失败`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`${label} 任务超时（${Math.round(MAX_POLL_MS / 60_000)} 分钟）`);
}

export type EvolinkSeedanceRunInput = {
  prompt: string;
  /** 兼容旧调用：单图图生 */
  imageUrl?: string;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  aspectRatio?: string;
  duration?: number;
  quality?: string;
  generateAudio?: boolean;
  contentFilter?: boolean;
  /** 2.5 text-to-video 可选联网增强 */
  webSearch?: boolean;
  /** 强制模式；默认按素材推断 */
  mode?: SeedanceEvolinkMode;
  version?: SeedanceEvolinkVersion;
};

/**
 * EvoLink Seedance · 文生 / 图生 / 参考生视频（2.0 默认开放；2.5 受闸门控制）
 */
export async function runEvolinkSeedanceVideo(
  input: EvolinkSeedanceRunInput,
): Promise<{ videoUrl: string; model: string; provider: "evolink"; version: SeedanceEvolinkVersion; mode: SeedanceEvolinkMode }> {
  const version: SeedanceEvolinkVersion = input.version === "2.5" ? "2.5" : "2.0";
  if (version === "2.5" && !isSeedance25Enabled()) {
    throw new Error(`${SEEDANCE_25_COMING_SOON_LABEL_EN}（EvoLink 尚未开放，请先用 Seedance 2.0）`);
  }

  const apiKey = String(process.env.EVOLINK_API_KEY || "").trim();
  if (!apiKey) throw new Error(`EVOLINK_API_KEY 未配置，无法使用 Seedance ${version}`);

  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error(`Seedance ${version} 需要提示词`);

  const imageUrls = [
    ...((input.imageUrls || []).map((u) => String(u || "").trim()).filter(Boolean)),
    ...(String(input.imageUrl || "").trim() ? [String(input.imageUrl).trim()] : []),
  ];
  const uniqueImages = Array.from(new Set(imageUrls));
  const videoUrls = Array.from(
    new Set((input.videoUrls || []).map((u) => String(u || "").trim()).filter(Boolean)),
  );
  const audioUrls = Array.from(
    new Set((input.audioUrls || []).map((u) => String(u || "").trim()).filter(Boolean)),
  );

  const mode =
    input.mode ||
    inferSeedanceMode({ imageUrls: uniqueImages, videoUrls, audioUrls });
  const model = resolveSeedanceModelId(version, mode);
  const duration = clampSeedanceDuration(version, input.duration);
  const aspectRatio = String(input.aspectRatio || "16:9").trim() || "16:9";
  const label = `Seedance ${version}`;

  const body: Record<string, unknown> = {
    model,
    prompt,
    duration,
    aspect_ratio: aspectRatio,
    generate_audio: input.generateAudio !== false,
    content_filter: input.contentFilter !== false,
  };

  if (version === "2.5") {
    body.quality = normalizeQuality25(input.quality);
    if (input.webSearch === true) {
      body.model_params = { web_search: true };
    }
  } else {
    body.quality = normalizeQuality20(input.quality);
  }

  if (mode === "image_to_video") {
    if (uniqueImages.length < 1) throw new Error(`${label} 图生视频需要至少 1 张参考图`);
    body.image_urls = uniqueImages.slice(0, 1);
  } else if (mode === "reference_to_video") {
    if (uniqueImages.length + videoUrls.length + audioUrls.length < 1) {
      throw new Error(`${label} 参考生视频需要至少 1 个 image/video/audio 参考`);
    }
    if (uniqueImages.length) {
      body.image_urls = uniqueImages.slice(0, version === "2.5" ? 30 : 9);
    }
    if (videoUrls.length) {
      body.video_urls = videoUrls.slice(0, version === "2.5" ? 10 : 3);
    }
    if (audioUrls.length) {
      body.audio_urls = audioUrls.slice(0, version === "2.5" ? 10 : 3);
    }
  }
  // text_to_video：不附媒体

  const createRes = await fetch(`${EVOLINK_BASE}/v1/videos/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  const createJson = (await createRes.json().catch(() => ({}))) as EvolinkVideoTask;

  if (!createRes.ok) {
    throw new Error(createJson.error?.message || createJson.message || `EvoLink 创建任务失败 (${createRes.status})`);
  }

  const immediateUrl = extractEvolinkVideoUrl(createJson);
  if (immediateUrl && String(createJson.status || "").toLowerCase() === "completed") {
    const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(immediateUrl);
    return { videoUrl, model, provider: "evolink", version, mode };
  }

  const taskId = String(createJson.id || "").trim();
  if (!taskId) throw new Error("EvoLink 未返回任务 ID");

  const sourceUrl = await pollEvolinkVideoTask(taskId, label);
  const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(sourceUrl);
  return { videoUrl, model, provider: "evolink", version, mode };
}

/** @deprecated 兼容旧名；等同 runEvolinkSeedanceVideo（2.0） */
export async function runEvolinkSeedance20(
  input: Omit<EvolinkSeedanceRunInput, "version">,
): Promise<{ videoUrl: string; model: string; provider: "evolink" }> {
  const out = await runEvolinkSeedanceVideo({ ...input, version: "2.0" });
  return { videoUrl: out.videoUrl, model: out.model, provider: out.provider };
}
