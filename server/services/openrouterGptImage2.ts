/**
 * OpenRouter `openai/gpt-image-2` fallback（POST /api/v1/images）
 *
 * 认证：Bearer OPENROUTER_API_KEY（见 https://openrouter.ai/docs/api_reference/authentication）
 * 可选：HTTP-Referer / X-Title 用于排行榜归因
 */
import { enforceSimplifiedChineseImagePrompt } from "./simplifiedChinese.js";
import { uploadBufferToPlatformStorage } from "./evolinkGptImage2.js";

const OPENROUTER_BASE = String(process.env.OPENROUTER_API_BASE || "https://openrouter.ai/api/v1").replace(
  /\/$/,
  "",
);
const MODEL = String(process.env.OPENROUTER_GPT_IMAGE2_MODEL || "openai/gpt-image-2").trim() || "openai/gpt-image-2";
const REQUEST_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.OPENROUTER_GPT_IMAGE2_TIMEOUT_MS) || 180_000, 60_000),
  600_000,
);

function appendImageFlowLog(log: string[] | undefined, message: string): void {
  if (!log) return;
  log.push(message);
}

export function getOpenRouterApiKey(): string {
  const raw = String(process.env.OPENROUTER_API_KEY || "").trim();
  // OpenRouter 钥多为 sk-or-…；亦接受其它 sk- 形，过滤中文/方括号占位
  if (!raw || !/^sk-[A-Za-z0-9]/.test(raw)) return "";
  return raw;
}

export function isOpenRouterGptImage2Configured(): boolean {
  return Boolean(getOpenRouterApiKey());
}

function resolveAspectRatio(aspectRatio: "9:16" | "16:9"): "9:16" | "16:9" {
  return aspectRatio === "16:9" ? "16:9" : "9:16";
}

function resolveQuality(raw?: string): "low" | "medium" | "high" {
  const q = String(raw || process.env.GPT_IMAGE2_QUALITY || "high")
    .trim()
    .toLowerCase();
  if (q === "low" || q === "medium" || q === "high") return q;
  return "high";
}

function openRouterHeaders(apiKey: string): Record<string, string> {
  const referer = String(process.env.OPENROUTER_HTTP_REFERER || process.env.APP_URL || "https://www.mvstudiopro.com")
    .trim()
    .replace(/\/+$/, "");
  const title = String(process.env.OPENROUTER_APP_TITLE || "MV Studio Pro").trim() || "MV Studio Pro";
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": referer || "https://www.mvstudiopro.com",
    "X-Title": title,
    "X-OpenRouter-Title": title,
  };
}

async function extractFirstImageBuffer(json: unknown): Promise<Buffer> {
  const data = (json as { data?: Array<{ b64_json?: string; url?: string }> })?.data;
  const item = Array.isArray(data) ? data[0] : null;
  if (!item) throw new Error("OpenRouter gpt-image-2: empty data[]");
  if (item.b64_json) return Buffer.from(String(item.b64_json), "base64");
  if (item.url) {
    const r = await fetch(String(item.url), { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`OpenRouter image download HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
  throw new Error("OpenRouter gpt-image-2: no b64_json/url");
}

/**
 * OpenRouter openai/gpt-image-2 → 落库公开 URL。
 * edit：把参考图 URL 放进 `input_references`（OpenRouter Image API）。
 */
export async function postOpenRouterGptImage2AndUpload(
  prompt: string,
  gcsSubdir: string,
  opts: {
    aspectRatio?: "9:16" | "16:9";
    quality?: string;
    flowLog?: string[];
    imageUrls?: string[];
    captureError?: { message?: string };
  } = {},
): Promise<string | null> {
  const L = opts.flowLog;
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    appendImageFlowLog(L, "[GPT-IMAGE-2·OpenRouter] OPENROUTER_API_KEY 缺失，跳过");
    return null;
  }

  const aspectRatio = resolveAspectRatio(opts.aspectRatio ?? "9:16");
  const quality = resolveQuality(opts.quality);
  const promptTrimmed = enforceSimplifiedChineseImagePrompt(String(prompt || "").trim());
  if (!promptTrimmed) {
    appendImageFlowLog(L, "[GPT-IMAGE-2·OpenRouter] prompt 为空，跳过");
    return null;
  }

  const refs = (opts.imageUrls || []).map((u) => String(u || "").trim()).filter(Boolean).slice(0, 16);
  const body: Record<string, unknown> = {
    model: MODEL,
    prompt: promptTrimmed,
    n: 1,
    aspect_ratio: aspectRatio,
    quality,
    output_format: "png",
  };
  if (refs.length) {
    body.input_references = refs.map((url) => ({ image_url: { url } }));
  }

  appendImageFlowLog(
    L,
    `[GPT-IMAGE-2·OpenRouter] POST ${OPENROUTER_BASE}/images · model=${MODEL} · ${aspectRatio} · quality=${quality}${refs.length ? ` · refs=${refs.length}` : ""}`,
  );

  try {
    const res = await fetch(`${OPENROUTER_BASE}/images`, {
      method: "POST",
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        (json as { error?: { message?: string } })?.error?.message || JSON.stringify(json).slice(0, 400);
      throw new Error(`OpenRouter images HTTP ${res.status}: ${msg}`);
    }
    const buffer = await extractFirstImageBuffer(json);
    const publicUrl = await uploadBufferToPlatformStorage(buffer, gcsSubdir, L);
    appendImageFlowLog(L, `[GPT-IMAGE-2·OpenRouter] 成功 · ${String(publicUrl).slice(0, 160)}…`);
    return publicUrl;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    appendImageFlowLog(L, `[GPT-IMAGE-2·OpenRouter] 异常 · ${msg}`);
    console.warn("[openrouterGptImage2]", msg);
    if (opts.captureError) opts.captureError.message = msg;
    return null;
  }
}
