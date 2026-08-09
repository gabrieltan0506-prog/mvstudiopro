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
// 实测 5s 片超分要 163–187s（约 35 倍片长）；漫剧整集（120s 档）按同比例约 70 分钟。
// 默认 3600s、帽 7200s；超线由 canvasVideoTask 转 timed_out_pending_reconcile，不误杀。
const MAX_POLL_MS = Math.min(
  Math.max(Number(process.env.WAVESPEED_UPSCALE_POLL_TIMEOUT_MS) || 3_600_000, 120_000),
  7_200_000,
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

export type WavespeedUpscalePollSnapshot =
  | { state: "completed"; sourceUrl: string }
  | { state: "failed"; error: string }
  | { state: "running"; status: string };

/**
 * 提交超分任务，拿 predictionId 就返回（不等完成）。`videoUrl` 必须是上游能
 * 直接抓取的公网地址。计费与档位合法性在扣费前由 `canWavespeedUpscale` /
 * `wavespeedUpscaleUsdCost` 决定，别在这里二次判断，免得两处口径漂移。
 */
export async function submitWavespeedVideoUpscale(input: {
  videoUrl: string;
  target: WavespeedUpscaleTarget;
}): Promise<{ predictionId: string }> {
  const apiKey = getWavespeedApiKey();
  if (!apiKey) throw new Error("视频高清放大暂不可用，请稍后重试");

  const source = String(input.videoUrl || "").trim();
  if (!/^https?:\/\//i.test(source)) throw new Error("需要一条可公开访问的视频地址");

  const createRes = await fetch(`${apiBase()}${WAVESPEED_VIDEO_UPSCALE_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ video: source, target_resolution: input.target }),
    signal: AbortSignal.timeout(60_000),
  });
  const createJson = (await createRes.json().catch(() => ({}))) as WavespeedPrediction;
  const created = pickPrediction(createJson);
  if (!createRes.ok || !created.id) {
    throw new Error(created.error || `超分任务创建失败 (${createRes.status})`);
  }
  return { predictionId: created.id };
}

/**
 * 轮询一次。查询接口自身故障（网络 / 限流 / 5xx）≠ 任务失败：当终态会
 * 「假失败真退分」，一律视作仍在跑；终态只认 2xx 响应体里的 failed/cancelled/timeout。
 * completed 时返回上游短期直链，镜像交给调用方。
 */
export async function pollWavespeedUpscaleOnce(
  predictionId: string,
): Promise<WavespeedUpscalePollSnapshot> {
  const apiKey = getWavespeedApiKey();
  if (!apiKey) return { state: "failed", error: "WAVESPEED_API_KEY 未配置" };

  let res: Response;
  try {
    res = await fetch(`${apiBase()}/predictions/${encodeURIComponent(predictionId)}/result`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    return {
      state: "running",
      status: `transient_fetch_error:${e instanceof Error ? e.name : "unknown"}`,
    };
  }
  const json = (await res.json().catch(() => ({}))) as WavespeedPrediction;
  if (!res.ok) {
    return { state: "running", status: `transient_http_${res.status}` };
  }
  const snap = pickPrediction(json);
  if (snap.status === "completed") {
    const out = snap.outputs.find((u) => u.trim());
    if (!out) return { state: "failed", error: "超分完成但未返回下载地址" };
    return { state: "completed", sourceUrl: out.trim() };
  }
  if (snap.status === "failed" || snap.status === "cancelled" || snap.status === "timeout") {
    return {
      state: "failed",
      error: snap.error || `超分${snap.status === "timeout" ? "超时" : "失败"}`,
    };
  }
  return { state: "running", status: snap.status || "processing" };
}

/** 同步跑完拿结果（提交 + 轮询 + 镜像）。异步任务框架请分别用 submit / pollOnce。 */
export async function runWavespeedVideoUpscale(input: {
  videoUrl: string;
  target: WavespeedUpscaleTarget;
}): Promise<{ videoUrl: string; predictionId: string; provider: "wavespeed" }> {
  const { predictionId } = await submitWavespeedVideoUpscale(input);

  const started = Date.now();
  while (Date.now() - started < MAX_POLL_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const snap = await pollWavespeedUpscaleOnce(predictionId);
    if (snap.state === "completed") {
      // 上游直链是短期的，镜像到 GCS 再交给前端，与成片同一口径
      const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(snap.sourceUrl);
      return { videoUrl, predictionId, provider: "wavespeed" };
    }
    if (snap.state === "failed") {
      throw new Error(snap.error);
    }
  }
  throw new Error("超分超时，请稍后重试");
}

export const WAVESPEED_UPSCALE_MAX_POLL_MS = MAX_POLL_MS;
