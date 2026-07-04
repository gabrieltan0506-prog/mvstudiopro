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

function clampDuration(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 8;
  return Math.min(15, Math.max(4, n));
}

function normalizeQuality(raw: unknown): "480p" | "720p" | "1080p" {
  const q = String(raw || "720p").trim().toLowerCase();
  if (q === "480p" || q === "1080p") return q;
  return "720p";
}

type EvolinkVideoTask = {
  id?: string;
  status?: string;
  progress?: number;
  results?: string[];
  result?: { video_url?: string; thumbnail_url?: string };
  output?: { video_url?: string; url?: string };
  error?: { code?: string; message?: string };
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

async function pollEvolinkVideoTask(taskId: string): Promise<string> {
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
      if (!url) throw new Error("Seedance 2.0 任务完成但未返回视频 URL");
      return url;
    }
    if (status === "failed" || status === "cancelled") {
      throw new Error(json.error?.message || "Seedance 2.0 视频生成失败");
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Seedance 2.0 任务超时（${Math.round(MAX_POLL_MS / 60_000)} 分钟）`);
}

/**
 * EvoLink Seedance 2.0 · 文生视频 / 图生视频（https://evolink.ai/seedance-2-0）
 */
export async function runEvolinkSeedanceVideo(input: {
  prompt: string;
  imageUrl?: string;
  aspectRatio?: string;
  duration?: number;
  quality?: "480p" | "720p" | "1080p";
  generateAudio?: boolean;
}): Promise<{ videoUrl: string; model: string; provider: "evolink" }> {
  const apiKey = String(process.env.EVOLINK_API_KEY || "").trim();
  if (!apiKey) throw new Error("EVOLINK_API_KEY 未配置，无法使用 Seedance 2.0");

  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("Seedance 2.0 需要提示词");

  const imageUrl = String(input.imageUrl || "").trim();
  const model = imageUrl ? "seedance-2.0-image-to-video" : "seedance-2.0-text-to-video";
  const duration = clampDuration(input.duration);
  const quality = normalizeQuality(input.quality);
  const aspectRatio = String(input.aspectRatio || "16:9").trim() || "16:9";

  const body: Record<string, unknown> = {
    model,
    prompt,
    duration,
    quality,
    aspect_ratio: aspectRatio,
    generate_audio: input.generateAudio !== false,
    content_filter: true,
  };

  if (imageUrl) {
    body.image_urls = [imageUrl];
  }

  const createRes = await fetch(`${EVOLINK_BASE}/v1/videos/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  const createJson = (await createRes.json().catch(() => ({}))) as EvolinkVideoTask & {
    id?: string;
    message?: string;
  };

  if (!createRes.ok) {
    throw new Error(createJson.error?.message || createJson.message || `EvoLink 创建任务失败 (${createRes.status})`);
  }

  const immediateUrl = extractEvolinkVideoUrl(createJson);
  if (immediateUrl && String(createJson.status || "").toLowerCase() === "completed") {
    const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(immediateUrl);
    return { videoUrl, model, provider: "evolink" };
  }

  const taskId = String(createJson.id || "").trim();
  if (!taskId) throw new Error("EvoLink 未返回任务 ID");

  const sourceUrl = await pollEvolinkVideoTask(taskId);
  const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(sourceUrl);
  return { videoUrl, model, provider: "evolink" };
}
