/**
 * Wan 3.0（公测）· WaveSpeed reference-to-video：提交 + 单次轮询。
 *
 * 与 wavespeedVideoUpscale 同一套异步 REST 形态：POST 拿 prediction id →
 * 轮 `/predictions/{id}/result` → 终态取 outputs[0]（短期直链，须镜像 GCS）。
 * 公测期排队极长（实弹见 2026-08-20 双单),轮询期限由 canvasVideoTask 统一治理。
 */
import {
  WAN30_REFERENCE_MAX,
  WAN30_WAVESPEED_PATH,
  clampWan30Duration,
  normalizeWan30AspectRatio,
  normalizeWan30Resolution,
} from "../../shared/wanWavespeedModels.js";
import { SubmitRejectedError, SubmitUnknownError } from "./submitOutcomeErrors.js";
import { getWavespeedApiKey } from "./wavespeedVideoUpscale.js";

function apiBase(): string {
  return String(process.env.WAVESPEED_API_BASE || "https://api.wavespeed.ai").replace(/\/$/, "");
}

export function isWavespeedWanConfigured(): boolean {
  return Boolean(getWavespeedApiKey());
}

type WavespeedPrediction = {
  data?: { id?: string; status?: string; outputs?: string[]; error?: string };
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

export async function submitWavespeedWanVideo(input: {
  prompt: string;
  imageUrls: string[];
  audioUrls?: string[];
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  /** 复杂漫剧提示词默认开(上游深思模式);简单镜头可关 */
  thinkingMode?: boolean;
  /** 0..2147483647;持久化到任务记录供复现 */
  seed?: number;
  enableAudio?: boolean;
}): Promise<{ predictionId: string }> {
  const apiKey = getWavespeedApiKey();
  if (!apiKey) throw new Error("Wan 3.0 通道暂不可用，请稍后重试");

  const images = (input.imageUrls || [])
    .map((u) => String(u || "").trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, WAN30_REFERENCE_MAX.image);
  if (!images.length) throw new Error("Wan 3.0 成片需要至少一张参考图");
  const audios = (input.audioUrls || [])
    .map((u) => String(u || "").trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, WAN30_REFERENCE_MAX.audio);

  const body: Record<string, unknown> = {
    prompt: String(input.prompt || "").trim(),
    reference_images: images,
    duration: clampWan30Duration(input.duration),
    resolution: normalizeWan30Resolution(input.resolution),
    aspect_ratio: normalizeWan30AspectRatio(input.aspectRatio),
    thinking_mode: input.thinkingMode !== false,
    enable_audio: input.enableAudio !== false,
  };
  const seed = Math.floor(Number(input.seed));
  if (Number.isFinite(seed) && seed >= 0 && seed <= 2147483647) body.seed = seed;
  if (audios.length) body.reference_audios = audios;

  /**
   * 七审补分型：POST 已发出后网络断/超时 = 任务可能已被受理（排队极长的上游尤甚），
   * 归 unknown——上层禁回落禁退款转对账；只有明确 4xx 才算确定没建单。
   */
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${WAN30_WAVESPEED_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new SubmitUnknownError(
      `Wan 3.0 提交结果未知：${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const json = (await res.json().catch(() => ({}))) as WavespeedPrediction;
  const created = pickPrediction(json);
  if (!res.ok || !created.id) {
    const detail = created.error || `Wan 3.0 任务创建失败 (${res.status})`;
    if ([400, 401, 403, 404, 413, 415, 422].includes(res.status)) {
      throw new SubmitRejectedError(detail);
    }
    // 5xx / 2xx 缺 id：单可能已建，禁回落
    throw new SubmitUnknownError(detail);
  }
  return { predictionId: created.id };
}

export type WavespeedWanPollSnapshot =
  | { state: "completed"; sourceUrl: string }
  | { state: "failed"; error: string }
  | { state: "running"; status: string };

export async function pollWavespeedWanOnce(
  predictionId: string,
): Promise<WavespeedWanPollSnapshot> {
  const apiKey = getWavespeedApiKey();
  if (!apiKey) return { state: "failed", error: "Wan 3.0 通道暂不可用" };
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/v3/predictions/${encodeURIComponent(predictionId)}/result`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { state: "running", status: "transient_fetch_error" };
  }
  if (res.status >= 500 || res.status === 429) {
    return { state: "running", status: `transient_http_${res.status}` };
  }
  if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 422) {
    // 明确不可重试:鉴权/参数错误再轮几小时也不会好,立即终态退分
    return { state: "failed", error: `Wan 3.0 查询被拒 HTTP ${res.status}(不可重试)` };
  }
  if (res.status === 404) {
    // 创建后最终一致性窗口:标记 transient,由任务框架的期限+对账治理,不无限白轮
    return { state: "running", status: "transient_http_404" };
  }
  const json = (await res.json().catch(() => ({}))) as WavespeedPrediction;
  const p = pickPrediction(json);
  if (p.status === "completed" || p.status === "succeeded") {
    const sourceUrl = p.outputs[0];
    if (!sourceUrl) return { state: "failed", error: "Wan 3.0 任务完成但未返回视频" };
    return { state: "completed", sourceUrl };
  }
  if (
    p.status === "failed" ||
    p.status === "error" ||
    p.status === "canceled" ||
    p.status === "cancelled" ||
    p.status === "timeout"
  ) {
    return { state: "failed", error: p.error || "Wan 3.0 生成失败" };
  }
  return { state: "running", status: p.status || "processing" };
}
