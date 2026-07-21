/**
 * 官方 OpenAI GPT Image 2（images/generations + images/edits 共用同一 snapshot）
 * 供 canvasGptImage2 / 平台单帧像素链（不再走 EvoLink）。
 *
 * 环境变量：
 * - OPENAI_IMAGE_API_KEY 或 OPENAI_API_KEY
 * - OPENAI_GPT_IMAGE2_MODEL（可选；默认钉 gpt-image-2-2026-04-21）
 */
import { enforceSimplifiedChineseImagePrompt } from "./simplifiedChinese.js";
import { uploadBufferToPlatformStorage } from "./evolinkGptImage2.js";

const OPENAI_BASE = String(process.env.OPENAI_API_BASE || "https://api.openai.com").replace(/\/$/, "");

/** 文档 snapshot：https://developers.openai.com/api/docs/models/gpt-image-2 */
export const OPENAI_GPT_IMAGE2_SNAPSHOT_DEFAULT = "gpt-image-2-2026-04-21" as const;

/**
 * 生图 / 改图共用。默认钉 snapshot；可用 OPENAI_GPT_IMAGE2_MODEL 覆盖（如回退别名 gpt-image-2）。
 */
export function resolveOpenAiGptImage2Model(): string {
  const raw = String(process.env.OPENAI_GPT_IMAGE2_MODEL || "").trim();
  if (raw === "gpt-image-2" || /^gpt-image-2-\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return OPENAI_GPT_IMAGE2_SNAPSHOT_DEFAULT;
}

/**
 * Fly worker 内等官方上游的 AbortSignal（非浏览器/Vercel 网关等待）。
 * 客户端应短入队 + 轮询；此处默认 5min，可用 OPENAI_GPT_IMAGE2_TIMEOUT_MS 覆写。
 */
const REQUEST_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.OPENAI_GPT_IMAGE2_TIMEOUT_MS) || 300_000, 60_000),
  600_000,
);

function appendImageFlowLog(log: string[] | undefined, message: string): void {
  if (!log) return;
  log.push(message);
}

function isValidOpenAiSkKey(raw: string): boolean {
  // 官方密钥以 sk- 开头；过滤占位伪值（中文、[set]、空串等）
  return /^sk-[A-Za-z0-9]/.test(raw);
}

export function getOpenAiImageApiKey(): string {
  // 逐个校验：IMAGE 钥若是无效占位，不得挡住可用的 OPENAI_API_KEY
  for (const candidate of [process.env.OPENAI_IMAGE_API_KEY, process.env.OPENAI_API_KEY]) {
    const raw = String(candidate || "").trim();
    if (isValidOpenAiSkKey(raw)) return raw;
  }
  return "";
}

export function isOpenAiGptImage2Configured(): boolean {
  return Boolean(getOpenAiImageApiKey());
}

function resolveOpenAiSize(aspectRatio: "9:16" | "16:9", explicitSize?: string): string {
  const custom = String(explicitSize || "").trim();
  if (custom && /^\d+x\d+$/i.test(custom)) return custom;
  return aspectRatio === "16:9" ? "1536x1024" : "1024x1536";
}

function resolveQuality(raw?: string): "low" | "medium" | "high" {
  const q = String(raw || process.env.GPT_IMAGE2_QUALITY || "high")
    .trim()
    .toLowerCase();
  if (q === "low" || q === "medium" || q === "high") return q;
  return "high";
}

async function downloadUrl(url: string): Promise<Buffer> {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`OpenAI ref download HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function sniffMime(buf: Buffer): "image/png" | "image/jpeg" | "image/webp" {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return "image/png";
}

async function extractFirstImageBuffer(json: unknown): Promise<Buffer> {
  const data = (json as { data?: Array<{ b64_json?: string; url?: string }> })?.data;
  const item = Array.isArray(data) ? data[0] : null;
  if (!item) throw new Error("OpenAI gpt-image-2: empty data[]");
  if (item.b64_json) return Buffer.from(String(item.b64_json), "base64");
  if (item.url) return downloadUrl(String(item.url));
  throw new Error("OpenAI gpt-image-2: no b64_json/url");
}

async function postGenerations(
  apiKey: string,
  prompt: string,
  size: string,
  quality: "low" | "medium" | "high",
  model: string,
): Promise<Buffer> {
  const body = {
    model,
    prompt,
    n: 1,
    size,
    quality,
    output_format: "png",
  };
  const res = await fetch(`${OPENAI_BASE}/v1/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (json as { error?: { message?: string } })?.error?.message || JSON.stringify(json).slice(0, 400);
    throw new Error(`OpenAI generations HTTP ${res.status}: ${msg}`);
  }
  return extractFirstImageBuffer(json);
}

async function postEdits(
  apiKey: string,
  prompt: string,
  size: string,
  quality: "low" | "medium" | "high",
  imageUrls: string[],
  maskUrl: string | undefined,
  model: string,
): Promise<Buffer> {
  const buffers = await Promise.all(imageUrls.slice(0, 16).map((u) => downloadUrl(u)));
  const maskBuf = maskUrl ? await downloadUrl(maskUrl) : null;

  const boundary = `----FormBoundary${Date.now()}`;
  const crlf = "\r\n";
  const parts: Buffer[] = [];
  const addField = (name: string, value: string) => {
    parts.push(
      Buffer.from(
        `--${boundary}${crlf}Content-Disposition: form-data; name="${name}"${crlf}${crlf}${value}${crlf}`,
      ),
    );
  };
  addField("model", model);
  addField("prompt", prompt);
  addField("size", size);
  addField("quality", quality);
  addField("output_format", "png");

  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i]!;
    const mime = sniffMime(buf);
    const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
    parts.push(
      Buffer.from(
        `--${boundary}${crlf}Content-Disposition: form-data; name="image[]"; filename="image-${i}.${ext}"${crlf}Content-Type: ${mime}${crlf}${crlf}`,
      ),
    );
    parts.push(buf);
    parts.push(Buffer.from(crlf));
  }
  if (maskBuf) {
    parts.push(
      Buffer.from(
        `--${boundary}${crlf}Content-Disposition: form-data; name="mask"; filename="mask.png"${crlf}Content-Type: image/png${crlf}${crlf}`,
      ),
    );
    parts.push(maskBuf);
    parts.push(Buffer.from(crlf));
  }
  parts.push(Buffer.from(`--${boundary}--${crlf}`));

  const res = await fetch(`${OPENAI_BASE}/v1/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: Buffer.concat(parts),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (json as { error?: { message?: string } })?.error?.message || JSON.stringify(json).slice(0, 400);
    throw new Error(`OpenAI edits HTTP ${res.status}: ${msg}`);
  }
  return extractFirstImageBuffer(json);
}

/**
 * 官方 OpenAI gpt-image-2 → 下载/解码 → GCS/Fly 公开 URL。
 */
export async function postOpenAiGptImage2AndUpload(
  prompt: string,
  gcsSubdir: string,
  opts: {
    aspectRatio?: "9:16" | "16:9";
    size?: string;
    quality?: string;
    flowLog?: string[];
    imageUrls?: string[];
    maskUrl?: string;
    captureError?: { message?: string };
  } = {},
): Promise<string | null> {
  const L = opts.flowLog;
  const apiKey = getOpenAiImageApiKey();
  if (!apiKey) {
    appendImageFlowLog(L, "[GPT-IMAGE-2·OpenAI] OPENAI_IMAGE_API_KEY/OPENAI_API_KEY 缺失，跳过");
    return null;
  }

  const aspectRatio = opts.aspectRatio ?? "9:16";
  const size = resolveOpenAiSize(aspectRatio, opts.size);
  const quality = resolveQuality(opts.quality);
  const promptTrimmed = enforceSimplifiedChineseImagePrompt(String(prompt || "").trim());
  if (!promptTrimmed) {
    appendImageFlowLog(L, "[GPT-IMAGE-2·OpenAI] prompt 为空，跳过");
    return null;
  }

  const refs = (opts.imageUrls || []).map((u) => String(u || "").trim()).filter(Boolean).slice(0, 16);
  const maskUrl = String(opts.maskUrl || "").trim() || undefined;
  const model = resolveOpenAiGptImage2Model();

  appendImageFlowLog(
    L,
    `[GPT-IMAGE-2·OpenAI] ${refs.length ? "edits" : "generations"} · model=${model} · size=${size} · quality=${quality}${refs.length ? ` · refs=${refs.length}` : ""}`,
  );

  try {
    const buffer = refs.length
      ? await postEdits(apiKey, promptTrimmed, size, quality, refs, maskUrl, model)
      : await postGenerations(apiKey, promptTrimmed, size, quality, model);
    const publicUrl = await uploadBufferToPlatformStorage(buffer, gcsSubdir, L);
    appendImageFlowLog(L, `[GPT-IMAGE-2·OpenAI] 成功 · ${String(publicUrl).slice(0, 160)}…`);
    return publicUrl;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    appendImageFlowLog(L, `[GPT-IMAGE-2·OpenAI] 异常 · ${msg}`);
    console.warn("[openaiGptImage2]", msg);
    if (opts.captureError) opts.captureError.message = msg;
    return null;
  }
}
