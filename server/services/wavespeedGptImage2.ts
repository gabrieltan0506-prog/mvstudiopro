/**
 * WaveSpeed `openai/gpt-image-2`（0909 用户拍板：OpenAI 官方 → WaveSpeed → EvoLink 兜底）。
 *
 * 文档：https://wavespeed.ai/docs/docs-api/openai/openai-gpt-image-2-text-to-image
 *       https://wavespeed.ai/docs/docs-api/openai/openai-gpt-image-2-edit
 * 与 Wan / 超分同一套形态：POST 拿 prediction id → 轮 `/api/v3/predictions/{id}/result` → outputs[0]。
 * 参数是**比例 + resolution(1k/2k/4k) + quality**，没有绝对像素 size（知识库《价格总表》0822 查实，禁照抄 EvoLink）。
 * edit 端点不支持 mask：带遮罩的请求直接跳过本通道。
 */
import { uploadBufferToPlatformStorage } from "./evolinkGptImage2.js";
import { getWavespeedApiKey } from "./wavespeedVideoUpscale.js";
import { submitWavespeedPredictionRequest } from "./wavespeedWanVideo.js";
import { enforceSimplifiedChineseImagePrompt } from "./simplifiedChinese.js";

export type WavespeedGptImage2Resolution = "1k" | "2k" | "4k";
export type WavespeedGptImage2Quality = "low" | "medium" | "high";

export const WAVESPEED_GPT_IMAGE2_T2I_PATH = "/api/v3/openai/gpt-image-2/text-to-image";
export const WAVESPEED_GPT_IMAGE2_EDIT_PATH = "/api/v3/openai/gpt-image-2/edit";
export const WAVESPEED_GPT_IMAGE2_MAX_REFS = 16;

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_MS = Math.min(
  Math.max(Number(process.env.WAVESPEED_GPT_IMAGE2_TIMEOUT_MS) || 300_000, 60_000),
  600_000,
);

function apiBase(): string {
  return String(process.env.WAVESPEED_API_BASE || "https://api.wavespeed.ai").replace(/\/$/, "");
}

function appendImageFlowLog(log: string[] | undefined, message: string): void {
  if (!log) return;
  log.push(message);
}

export function isWavespeedGptImage2Configured(): boolean {
  return Boolean(getWavespeedApiKey());
}

export function normalizeWavespeedGptImage2Resolution(raw: unknown): WavespeedGptImage2Resolution {
  const v = String(raw || "").trim().toLowerCase();
  return v === "1k" || v === "2k" || v === "4k" ? v : "2k";
}

/** 与 OpenAI/EvoLink 共用的画幅口径：9:16 / 16:9；WaveSpeed 两个都收 */
export function buildWavespeedGptImage2Body(input: {
  prompt: string;
  aspectRatio: "9:16" | "16:9";
  resolution: WavespeedGptImage2Resolution;
  quality: WavespeedGptImage2Quality;
  imageUrls?: string[];
}): { path: string; body: Record<string, unknown> } {
  const images = (input.imageUrls || []).map((u) => String(u || "").trim()).filter(Boolean).slice(0, WAVESPEED_GPT_IMAGE2_MAX_REFS);
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    aspect_ratio: input.aspectRatio,
    resolution: input.resolution,
    quality: input.quality,
    output_format: "png",
  };
  if (images.length) {
    body.images = images;
    return { path: WAVESPEED_GPT_IMAGE2_EDIT_PATH, body };
  }
  return { path: WAVESPEED_GPT_IMAGE2_T2I_PATH, body };
}

type PredictionJson = {
  data?: { id?: string; status?: string; outputs?: string[]; error?: string };
  id?: string;
  status?: string;
  outputs?: string[];
  error?: string;
  message?: string;
};

async function pollWavespeedGptImage2(predictionId: string, flowLog?: string[]): Promise<string> {
  const apiKey = getWavespeedApiKey();
  const started = Date.now();
  let lastStatus = "";
  while (Date.now() - started < MAX_POLL_MS) {
    let res: Response | null = null;
    try {
      res = await fetch(`${apiBase()}/api/v3/predictions/${encodeURIComponent(predictionId)}/result`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      res = null;
    }
    if (res && (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 422)) {
      throw new Error(`WaveSpeed gpt-image-2 查询被拒 HTTP ${res.status}`);
    }
    if (res && res.ok) {
      const json = (await res.json().catch(() => ({}))) as PredictionJson;
      const d = json.data ?? json;
      const status = String(d?.status || "").trim().toLowerCase();
      if (status !== lastStatus) {
        lastStatus = status;
        appendImageFlowLog(flowLog, `[GPT-IMAGE-2·WaveSpeed] 任务 ${predictionId} · status=${status || "?"}`);
      }
      const outputs = Array.isArray(d?.outputs) ? d.outputs.filter((u) => typeof u === "string" && u.trim()) : [];
      if (status === "completed" || status === "succeeded") {
        if (!outputs[0]) throw new Error("WaveSpeed gpt-image-2 completed but outputs[] empty");
        return outputs[0];
      }
      if (status === "failed" || status === "error" || status === "canceled" || status === "cancelled" || status === "timeout") {
        throw new Error(`WaveSpeed gpt-image-2 failed: ${String((d as { error?: string })?.error || json.message || status)}`);
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`WaveSpeed gpt-image-2 poll timeout after ${MAX_POLL_MS}ms · id=${predictionId}`);
}

/**
 * WaveSpeed gpt-image-2：提交 → 轮询 → 下载 → GCS/Fly。失败回 null 并把原因写进 captureError，由上层换下一家。
 */
export async function postWavespeedGptImage2AndUpload(
  prompt: string,
  gcsSubdir: string,
  opts: {
    aspectRatio?: "9:16" | "16:9";
    resolution?: WavespeedGptImage2Resolution | string;
    quality?: WavespeedGptImage2Quality | string;
    imageUrls?: string[];
    maskUrl?: string;
    flowLog?: string[];
    captureError?: { message?: string };
  } = {},
): Promise<string | null> {
  const L = opts.flowLog;
  if (!isWavespeedGptImage2Configured()) {
    appendImageFlowLog(L, "[GPT-IMAGE-2·WaveSpeed] WAVESPEED_API_KEY 缺失，跳过");
    return null;
  }
  if (String(opts.maskUrl || "").trim()) {
    const msg = "WaveSpeed gpt-image-2 edit 不支持遮罩（mask），跳过本通道";
    appendImageFlowLog(L, `[GPT-IMAGE-2·WaveSpeed] ${msg}`);
    if (opts.captureError) opts.captureError.message = msg;
    return null;
  }
  const promptTrimmed = enforceSimplifiedChineseImagePrompt(String(prompt || "").trim());
  if (!promptTrimmed) return null;
  const q = String(opts.quality || "high").trim().toLowerCase();
  const quality: WavespeedGptImage2Quality = q === "low" || q === "medium" ? q : "high";
  const { path, body } = buildWavespeedGptImage2Body({
    prompt: promptTrimmed,
    aspectRatio: opts.aspectRatio ?? "9:16",
    resolution: normalizeWavespeedGptImage2Resolution(opts.resolution),
    quality,
    imageUrls: opts.imageUrls,
  });
  appendImageFlowLog(
    L,
    `[GPT-IMAGE-2·WaveSpeed] POST ${path} · aspect=${body.aspect_ratio} · resolution=${body.resolution} · quality=${quality}${Array.isArray(body.images) ? ` · edit·参考图=${(body.images as string[]).length}张` : ""}`,
  );
  try {
    const { predictionId } = await submitWavespeedPredictionRequest(path, body, "WaveSpeed gpt-image-2");
    const sourceUrl = await pollWavespeedGptImage2(predictionId, L);
    const r = await fetch(sourceUrl, { signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`WaveSpeed image download HTTP ${r.status}`);
    const buffer = Buffer.from(await r.arrayBuffer());
    return await uploadBufferToPlatformStorage(buffer, gcsSubdir, L);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendImageFlowLog(L, `[GPT-IMAGE-2·WaveSpeed] 失败 · ${msg.slice(0, 200)}`);
    if (opts.captureError) opts.captureError.message = msg;
    return null;
  }
}
