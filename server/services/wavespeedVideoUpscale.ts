/**
 * WaveSpeed · ByteDance Video Upscaler：提交 + 轮询。
 *
 * 异步 REST：POST 拿 prediction id → 每 2 秒轮 `/predictions/{id}/result` → 终态取 outputs。
 * 成品链接是上游的短期直链，与成片一样镜像到 GCS 再返回，避免过期。
 */
import { mirrorSeedanceMp4ToGcsSignedUrl } from "./seedanceVideo.js";
import {
  WAVESPEED_API_BASE_DEFAULT,
  WAVESPEED_VIDEO_UPSCALE_PATH,
  type WavespeedUpscaleTarget,
} from "../../shared/wavespeedVideoUpscaleModels.js";

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = Math.min(
  Math.max(Number(process.env.WAVESPEED_UPSCALE_POLL_TIMEOUT_MS) || 900_000, 120_000),
  1_800_000,
);

export function getWavespeedApiKey(): string {
  return String(process.env.WAVESPEED_API_KEY || "").trim();
}

export function isWavespeedUpscaleConfigured(): boolean {
  return Boolean(getWavespeedApiKey());
}

function apiBase(): string {
  return String(process.env.WAVESPEED_API_BASE || WAVESPEED_API_BASE_DEFAULT).replace(/\/$/, "");
}

type WavespeedPrediction = {
  data?: {
    id?: string;
    status?: string;
    outputs?: string[];
    error?: string;
  };
  id?: string;
  status?: string;
  outputs?: string[];
  message?: string;
};

function pickPrediction(json: WavespeedPrediction) {
  const d = json?.data ?? json;
  return {
    id: String(d?.id || "").trim(),
    status: String(d?.status || "").trim().toLowerCase(),
    outputs: Array.isArray(d?.outputs) ? d.outputs.filter((u) => typeof u === "string") : [],
    error: String((d as { error?: string })?.error || json?.message || "").trim(),
  };
}

/**
 * 超分一条视频。`videoUrl` 必须是上游能直接抓取的公网地址。
 *
 * 只做「跑完拿结果」，不管计费与档位合法性——那两件在扣费前由
 * `canWavespeedUpscale` / `wavespeedUpscaleUsdCost` 决定，别在这里二次判断，
 * 免得两处口径漂移（画布 2K 那次就是判定分散在两层才出的事）。
 */
export async function runWavespeedVideoUpscale(input: {
  videoUrl: string;
  target: WavespeedUpscaleTarget;
}): Promise<{ videoUrl: string; predictionId: string; provider: "wavespeed" }> {
  const apiKey = getWavespeedApiKey();
  if (!apiKey) throw new Error("视频高清放大暂不可用，请稍后重试");

  const source = String(input.videoUrl || "").trim();
  if (!/^https?:\/\//i.test(source)) throw new Error("需要一条可公开访问的视频地址");

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const createRes = await fetch(`${apiBase()}${WAVESPEED_VIDEO_UPSCALE_PATH}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ video: source, target_resolution: input.target }),
    signal: AbortSignal.timeout(60_000),
  });
  const createJson = (await createRes.json().catch(() => ({}))) as WavespeedPrediction;
  const created = pickPrediction(createJson);
  if (!createRes.ok || !created.id) {
    throw new Error(created.error || `超分任务创建失败 (${createRes.status})`);
  }

  const started = Date.now();
  while (Date.now() - started < MAX_POLL_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`${apiBase()}/predictions/${encodeURIComponent(created.id)}/result`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await res.json().catch(() => ({}))) as WavespeedPrediction;
    const snap = pickPrediction(json);
    if (snap.status === "completed") {
      const out = snap.outputs.find((u) => u.trim());
      if (!out) throw new Error("超分完成但未返回下载地址");
      // 上游直链是短期的，镜像到 GCS 再交给前端，与成片同一口径
      const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(out.trim());
      return { videoUrl, predictionId: created.id, provider: "wavespeed" };
    }
    if (snap.status === "failed" || snap.status === "cancelled" || snap.status === "timeout") {
      throw new Error(snap.error || `超分${snap.status === "timeout" ? "超时" : "失败"}`);
    }
  }
  throw new Error("超分超时，请稍后重试");
}
