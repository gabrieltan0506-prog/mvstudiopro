import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getVertexAccessToken } from "../server/utils/vertex";
import { runVertexUpscaleImage, type VertexUpscaleResult } from "../server/services/vertexImage";
import { randomUUID, createHash } from "node:crypto";
import { uploadBufferToGcs, uploadBufferToGcsIfAbsent, getGcsBucketName, signGsUriV4ReadUrl } from "../server/services/gcs";
import { resolveGeminiModel, type GeminiModelDomain } from "../shared/geminiModelConfig";
import {
  buildManhuaClipQualityPrompt,
  MANHUA_CLIP_QUALITY_KEYS,
  parseManhuaClipQualityMarkdown,
} from "../shared/manhuaClipQuality";
import {
  hasSupervisorRole,
  isInternalGoogleMediaOp,
  isRetiredGoogleVideoOp,
} from "../shared/internalMediaEndpointPolicy";
import { assertSongOperationMaterialRead } from "../server/services/songOperationMediaAccess";
import { isAllowedCanvasMaterialGcsUri } from "../shared/canvasMaterialReadPolicy";
export { runVertexUpscaleImage, type VertexUpscaleResult };

/**
 * Vercel 上以 Serverless 跑本檔時必配：4K / 大 Base64 回傳若超過平台預設時長會直接 504，
 * 與程式內 `AbortSignal.timeout(120000)` 對齊並留裕度（依方案可在 Vercel 控制台再调高）。
 * Fly 部署則以 `fly.toml` → `http_service.http_options.idle_timeout` 為準（本倉已設 900s）。
 */
export const config = {
  maxDuration: 300,
};

/**
 * Google Gateway (single function)
 * - op=geminiScript    (Gemini text)
 * - op=vertexTranslate（Vertex IAM 纯文本翻译；**locations/global**；模型 gemini-3-flash-preview，供 TestLab）
 * - op=nanoImage       Vertex **`generateContent` 圖像**：Nano Banana 2（Flash）/ Nano Banana Pro。
 * - op=canvasVisionMarkdown / videoReversePrompt / manhuaClipQualityReview（1110：媒体先存 GCS → Gemini 两跳 Vertex gs:// → EvoLink 签名 https）
 * - op=manhuaAudioGetUploadUrl / manhuaAudioClimaxScan（漫剧学习语音 · Gemini Flash）
 * - op=manhuaTemplateFrameGetUploadUrl / manhuaTemplateFrameScan（漫剧学习读帧 · GPT-5.6 Terra · high）
 * - Veo / Google Omni / translateForVeo 已淘汰：isRetiredGoogleVideoOp 统一 410，处理代码已删除。
 *
 * Env:
 * - **Vertex IAM（`generateContent` 圖像、Gemini Script 等 `aiplatform` 呼叫）**：`GOOGLE_APPLICATION_CREDENTIALS_JSON` **或** `GOOGLE_APPLICATION_CREDENTIALS`（金鑰檔路徑）；換取短效 **Bearer token**，**非** URL `?key=`。
 * - 本文件不读 Gemini API 直连密钥：Gemini 只走 Vertex → EvoLink 两跳（EVOLINK_API_KEY），模型经 shared/geminiModelConfig.ts 解析。
 * - VERTEX_PROJECT_ID（Vertex 圖像 / geminiScript 等必填；可另備 GOOGLE_CLOUD_PROJECT）
 * - VERTEX_IMAGE_MODEL_FLASH / VERTEX_IMAGE_MODEL_PRO
 * - BLOB_READ_WRITE_TOKEN (optional for fetching private blob url)
 */

function s(v:any){ if(v==null) return ""; if(Array.isArray(v)) return String(v[0] ?? ""); return String(v); }
function jparse(t:string){ try{return JSON.parse(t)}catch{return null} }
function getBody(req:VercelRequest){
  const b:any = (req as any).body;
  if(!b) return {};
  if(typeof b==="string") return jparse(b) ?? {};
  return b;
}

async function resolveGoogleGatewayUser(
  req: VercelRequest,
): Promise<{ userId: number; role: string } | null> {
  try {
    const { sdk } = await import("../server/_core/sdk.js");
    const user = await sdk.authenticateRequest(req as any, { silentMissing: true });
    const userId = Number((user as any)?.id);
    if (!Number.isFinite(userId) || userId <= 0) return null;
    return { userId, role: String((user as any)?.role || "") };
  } catch {
    return null;
  }
}

export function validateLegacyUpscaleAccess(input: {
  method?: string;
  role?: string;
  upscaleFactor?: string;
}):
  | { ok: true; upscaleFactor: "x2" | "x4" }
  | { ok: false; status: 400 | 403 | 405; error: string } {
  if (input.method !== "POST") {
    return { ok: false, status: 405, error: "Method not allowed" };
  }
  if (input.role !== "admin" && input.role !== "supervisor") {
    return { ok: false, status: 403, error: "admin_or_supervisor_required" };
  }
  const factor = String(input.upscaleFactor || "").trim().toLowerCase();
  if (factor !== "x2" && factor !== "x4") {
    return { ok: false, status: 400, error: "unsupported_upscale_factor" };
  }
  return { ok: true, upscaleFactor: factor };
}

function baseUrlFor(location:string){
  return location==="global" ? "https://aiplatform.googleapis.com" : `https://${location}-aiplatform.googleapis.com`;
}

function extractGeneratedImages(raw:any): Array<{ data: string; mimeType: string }> {
  const images: Array<{ data: string; mimeType: string }> = [];
  const parts = Array.isArray(raw?.candidates?.[0]?.content?.parts) ? raw.candidates[0].content.parts : [];
  for (const part of parts) {
    const data = s(part?.inlineData?.data).trim();
    if (data) {
      images.push({ data, mimeType: s(part?.inlineData?.mimeType || "image/png").trim() || "image/png" });
    }
  }
  const generatedImages = Array.isArray(raw?.generatedImages) ? raw.generatedImages : [];
  for (const item of generatedImages) {
    const data = s(item?.image?.bytesBase64Encoded || item?.bytesBase64Encoded || item?.imageBytes).trim();
    if (data) {
      images.push({ data, mimeType: s(item?.image?.mimeType || item?.mimeType || "image/png").trim() || "image/png" });
    }
  }
  const predictions = Array.isArray(raw?.predictions) ? raw.predictions : [];
  for (const item of predictions) {
    const data = s(item?.bytesBase64Encoded || item?.image?.bytesBase64Encoded || item?.b64Json).trim();
    if (data) {
      images.push({ data, mimeType: s(item?.mimeType || item?.image?.mimeType || "image/png").trim() || "image/png" });
    }
  }
  return images;
}

async function fetchJson(url:string, init:RequestInit){
  const r = await fetch(url, init);
  const t = await r.text();
  const j = jparse(t);
  return { ok:r.ok, status:r.status, url, json:j, rawText:t.slice(0,4000) };
}

function shouldRetryVertexImage(status:number, json:any, rawText:string){
  const message = String(json?.error?.status || json?.error?.message || rawText || "").toUpperCase();
  return status === 429 || message.includes("RESOURCE_EXHAUSTED");
}

/** 文本 generateContent：配额 / 瞬时不可用可短退避重试（角色卡曾 503） */
function shouldRetryVertexText(status: number, json: any, rawText: string) {
  if (status === 429 || status === 503 || status === 502 || status === 504) return true;
  const message = String(json?.error?.status || json?.error?.message || rawText || "").toUpperCase();
  return (
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("UNAVAILABLE") ||
    message.includes("DEADLINE_EXCEEDED") ||
    message.includes("HIGH_DEMAND")
  );
}

async function sleep(ms:number){
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const NANO_IMAGE_GCS_PREFIX = "generated/nano-image";

/** Vertex 推論與 GCS 同 GCP 作業時，bytes 寫桶通常極快（內網/短骨幹）；回傳簽名 GET 給調用方拉圖。 */
async function tryDataUriToGcsSignedUrl(dataUri: string): Promise<string | null> {
  const m = dataUri.match(/^data:([^;,]+);base64,(.+)$/);
  if (!m?.[2]) return null;
  try {
    const mimeType = String(m[1] || "image/png").trim() || "image/png";
    const buffer = Buffer.from(String(m[2]).trim(), "base64");
    if (!buffer.length) return null;
    const ext =
      mimeType.includes("jpeg") || mimeType.includes("jpg")
        ? "jpg"
        : mimeType.includes("webp")
          ? "webp"
          : "png";
    const objectName = `${NANO_IMAGE_GCS_PREFIX}/${Date.now()}_${Math.random().toString(36).slice(2, 11)}.${ext}`;
    const { gcsUri } = await uploadBufferToGcs({ objectName, buffer, contentType: mimeType });
    return signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
  } catch (e: any) {
    console.warn("[api/google] nanoImage → GCS failed:", e?.message || e);
    return null;
  }
}

/** 將 data: 落地 GCS 並改為簽名 https；非 data: 或上傳失敗則保留原字符串。 */
async function materializeDataImageUrlsToGcs(urls: string[]): Promise<string[]> {
  return Promise.all(
    urls.map(async (u) => {
      if (!u.startsWith("data:")) return u;
      return (await tryDataUriToGcsSignedUrl(u)) || u;
    }),
  );
}

/** 預設將 data: 落地 GCS 再響應（單請求內 await）；多圖並行上傳。業務層長流程請另開異步，勿塞滿同步 API。 */
async function buildNanoImageResponseBody(opts: {
  ok: boolean;
  status: number;
  model?: string;
  url: string;
  raw: unknown;
  imageUrls: string[];
  forceInlineBase64: boolean;
  extra?: Record<string, unknown>;
}) {
  let imageUrls = opts.imageUrls;
  if (!opts.forceInlineBase64) {
    imageUrls = await materializeDataImageUrlsToGcs(imageUrls);
  }
  const hadDataUri = opts.imageUrls.some((u) => u.startsWith("data:"));
  const noDataLeft = !imageUrls.some((u) => u.startsWith("data:"));
  const omitRaw = !opts.forceInlineBase64 && opts.ok && hadDataUri && noDataLeft;
  return {
    ok: opts.ok,
    status: opts.status,
    ...(opts.model ? { model: opts.model } : {}),
    url: opts.url,
    imageUrl: imageUrls[0] || "",
    imageUrls,
    imageCount: imageUrls.length,
    ...(omitRaw ? { rawOmittedDueToGcs: true as const } : { raw: opts.raw }),
    ...(opts.extra || {}),
  };
}

/** 图片：data: 解码或下载（403 时带 BLOB 令牌重试），≤10MB。只取字节，落 GCS 后以 gs:// / 签名 https 交模型（不内联）。 */
async function fetchImageBuffer(imageUrl: string, fallbackMime = "image/jpeg"): Promise<{ buffer: Buffer; mimeType: string; via: "dataUrl" | "url" }> {
  const url = s(imageUrl).trim();
  if (!url) throw new Error("missing_image_url");
  if (url.startsWith("data:")) {
    const dataMatch = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (!dataMatch?.[2]) throw new GoogleVisionMediaError("bad_data_url", 400, "图片数据格式不正确");
    const buffer = Buffer.from(String(dataMatch[2]).trim(), "base64");
    if (!buffer.length) throw new Error("empty_image");
    if (buffer.length > 10 * 1024 * 1024) throw new Error("image_too_large");
    return { buffer, mimeType: String(dataMatch[1] || fallbackMime).trim().toLowerCase(), via: "dataUrl" };
  }
  if (!/^https?:\/\//i.test(url)) throw new Error("bad_image_url");

  const token = s(process.env.BLOB_READ_WRITE_TOKEN).trim();
  const headers: Record<string, string> = { "User-Agent": "mvstudiopro/1.0 (+google-fetch)" };
  let r = await fetch(url, { redirect: "follow", headers });
  if (r.status === 403 && token) {
    headers["Authorization"] = `Bearer ${token}`;
    r = await fetch(url, { redirect: "follow", headers });
  }
  if (!r.ok) throw new Error("image_fetch_failed:" + r.status);
  const ct = String(r.headers.get("content-type") || "").split(";")[0]!.trim().toLowerCase();
  const buffer = Buffer.from(await r.arrayBuffer());
  if (!buffer.length) throw new Error("empty_image");
  if (buffer.length > 10 * 1024 * 1024) throw new Error("image_too_large");
  return { buffer, mimeType: /^image\//.test(ct) ? ct : fallbackMime, via: "url" };
}

/** 视频：下载 ≤30MB（原质检上限），落 GCS 后交模型（不内联）。 */
async function fetchVideoBuffer(videoUrl: string): Promise<{ buffer: Buffer; mimeType: string; via: "url" }> {
  const url = s(videoUrl).trim();
  if (!url) throw new Error("missing_video_url");
  if (!/^https?:\/\//i.test(url)) throw new Error("bad_video_url");
  const r = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "mvstudiopro/1.0 (+clip-quality)" },
  });
  if (!r.ok) throw new Error(`video_fetch_failed:${r.status}`);
  const ct = String(r.headers.get("content-type") || "").split(";")[0]!.trim().toLowerCase();
  const buffer = Buffer.from(await r.arrayBuffer());
  if (!buffer.length) throw new Error("empty_video");
  if (buffer.length > 30 * 1024 * 1024) throw new Error("video_too_large");
  return { buffer, mimeType: /^video\//.test(ct) ? ct : "video/mp4", via: "url" };
}

/**
 * 1110 听音通道合规（照抄 musicMvLyricTable 43f248f1 与模板学习做法）：音频先存 GCS（用户前缀），
 * 再走 geminiAudioJsonWithFallback 两跳 —— Vertex 读 gs://，EvoLink 读不了 gs:// → V4 签名 https（1 小时）；
 * 不直连 Gemini API 密钥、不走 OpenRouter、不内联 base64。每跳 request/raw/decoded/parsed/rejected 由两跳函数
 * 永久落证据；证据里只记 gs://，签名链接不落档。
 */
// 1110：两跳模型不在此写死，统一用 server/gemini-audio.ts resolveGeminiAudioTwoHopModel()（env 可配，缺省 gemini-3.8-flash）。

function googleAudioEvidenceSaver(bucket: string, prefix: string) {
  return async (name: string, value: unknown) => {
    await uploadBufferToGcsIfAbsent({ bucket, objectName: `${prefix}/${name}.json`, buffer: Buffer.from(JSON.stringify(value)), contentType: "application/json" });
  };
}

function googleAudioTwoHopMedia(gsUri: string) {
  return { vertexFileUri: gsUri, evolinkFileUri: () => signGsUriV4ReadUrl(gsUri, 3600) };
}

function googleAudioObjectExt(mimeType: string): string {
  const sub = String(mimeType || "").toLowerCase().split(";")[0]!.split("/")[1] || "";
  return ({ mpeg: "mp3", mp3: "mp3", mp4: "m4a", "x-m4a": "m4a", wav: "wav", "x-wav": "wav", webm: "webm", ogg: "ogg", flac: "flac", aac: "aac" } as Record<string, string>)[sub] || "audio";
}

/** 原 analyzeManhuaDramaAudioFromUrl 的下载校验（http(s)、跟随跳转、非空、18MB 上限）；下载后转存 GCS，不再内联。 */
async function fetchManhuaScanAudio(audioUrl: string): Promise<Buffer> {
  if (!/^https?:\/\//i.test(audioUrl)) throw new Error("missing_or_invalid_audio_url");
  const r = await fetch(audioUrl, { redirect: "follow", headers: { "User-Agent": "mvstudiopro/1.0 (+manhua-audio-climax)" } });
  if (!r.ok) throw new Error(`audio_fetch_failed:${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error("empty_audio");
  if (buf.length > 18 * 1024 * 1024) throw new Error(`audio_too_large:${buf.length}`);
  return buf;
}

/**
 * 漫剧学习直传签名（听音音频 / 读帧关键帧）：须登录；对象名由服务端生成，落本人上传前缀
 * uploads/u<uid>/<子目录>/<UUID>-<文件名>（同 getVideoUploadSignedUrl 口径，客户端不可指定），
 * 听音扫描的归属核验（resolveRegisteredPostProdMediaSource）按同一前缀放行。
 * 文件名只作可读后缀：非常规字符折成 "-"、连续点折成一个（核验侧拒收含 ".." 的对象名）。
 * Content-Type 签入 URL、有效期 20 分钟，均同原入口。
 */
async function issueManhuaLearnUploadUrl(
  req: VercelRequest,
  res: VercelResponse,
  input: { fileName: string; mimeType: string; subdir: string },
) {
  const viewer = await resolveGoogleGatewayUser(req);
  if (!viewer) return res.status(401).json({ ok: false, error: "authentication_required", message: "请先登录后再上传文件" });
  try {
    const { createGcsSignedUploadUrl } = await import("../server/services/gcs");
    const { userUploadsPrefix } = await import("../server/services/postProdMediaSource");
    const safeName = input.fileName.replace(/[^\w.\-]+/g, "-").replace(/\.{2,}/g, ".").slice(0, 80);
    const signed = await createGcsSignedUploadUrl({
      fileName: input.fileName,
      contentType: input.mimeType,
      objectName: `${userUploadsPrefix(String(viewer.userId))}${input.subdir}/${randomUUID()}-${safeName}`,
      expiresInMinutes: 20,
    });
    return res.status(200).json({ ok: true, ...signed, mimeType: input.mimeType });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: "gcs_signed_upload_failed", detail: msg.slice(0, 240) });
  }
}

/**
 * 1110 看图 / 视频反推帧 / 成片质检通道合规（同听音做法）：媒体先存 GCS（用户前缀，或核验为本人的 gs://），
 * 再走 geminiAudioJsonWithFallback 两跳 —— Vertex 读 gs://，EvoLink 读 V4 签名 https（1 小时）；
 * 不直连 Gemini API 密钥、不内联 base64；模型经 shared/geminiModelConfig.ts 解析（缺省 gemini-3.8-flash，不收前端传的模型名）。
 * 每跳 request/raw/decoded/parsed/rejected 由两跳函数永久落证据；证据只记 gs://，不记签名链接或调用方传入的原链接。
 */
class GoogleVisionMediaError extends Error {
  constructor(readonly code: string, readonly status: 400 | 403 | 502, message: string) {
    super(message);
  }
}

type GoogleVisionMediaInput = { kind: "image" | "video"; url: string; gcsUri?: string; mimeType: string; label?: string };
type GoogleVisionStagedMedia = { gsUri: string; mimeType: string; via: "gcs" | "url" | "dataUrl"; bytes?: number; sha256?: string };

function googleVisionObjectExt(mimeType: string): string {
  const sub = String(mimeType || "").toLowerCase().split(";")[0]!.split("/")[1] || "";
  return ({ jpeg: "jpg", jpg: "jpg", png: "png", webp: "webp", gif: "gif", heic: "heic", mp4: "mp4", quicktime: "mov", webm: "webm" } as Record<string, string>)[sub] || "bin";
}

/** 单个媒体落 GCS：gs:// 先按后期素材登记核验本人归属（不下载）；核验不过且有链接时按链接下载转存，否则 403。 */
async function stageGoogleVisionMedia(userId: number, bucket: string, prefix: string, index: number, item: GoogleVisionMediaInput): Promise<GoogleVisionStagedMedia> {
  const gcsUri = s(item.gcsUri).trim();
  if (gcsUri.startsWith("gs://")) {
    try {
      const { resolveRegisteredPostProdMediaSource } = await import("../server/services/postProdMediaSource");
      return { gsUri: await resolveRegisteredPostProdMediaSource({ userId: String(userId), source: gcsUri }), mimeType: item.mimeType, via: "gcs" };
    } catch {
      // 不能证明是本人对象：调用方若同时持有 https 链接，按链接下载转存（不扩大读取面），否则拒绝。
      if (!s(item.url).trim()) throw new GoogleVisionMediaError("gcs_uri_not_allowed", 403, "素材不属于本人或尚未登记");
    }
  }
  const fetched = item.kind === "video" ? await fetchVideoBuffer(item.url) : await fetchImageBuffer(item.url, item.mimeType);
  const objectName = `${prefix}/media-${String(index + 1).padStart(2, "0")}.${googleVisionObjectExt(fetched.mimeType)}`;
  await uploadBufferToGcsIfAbsent({ bucket, objectName, buffer: fetched.buffer, contentType: fetched.mimeType });
  return {
    gsUri: `gs://${bucket}/${objectName}`,
    mimeType: fetched.mimeType,
    via: fetched.via,
    bytes: fetched.buffer.length,
    sha256: createHash("sha256").update(fetched.buffer).digest("hex"),
  };
}

const GOOGLE_VISION_MARKDOWN_SCHEMA = { type: "OBJECT", properties: { markdown: { type: "STRING" } }, required: ["markdown"] };
const GOOGLE_VISION_MARKDOWN_WRAP = "【输出封装】把上面要求输出的完整原文（Markdown 或逐行结果）原样写进 JSON 的 markdown 字段，保留换行；JSON 之外不要输出任何内容。";

type GoogleVisionTwoHopOutcome =
  | { ok: true; markdown: string; staged: GoogleVisionStagedMedia[] }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * 看图类入口共用：媒体逐个落 GCS → 两跳（主媒体 + extraMedia 按序，全部 fileData 引用）→ markdown。
 * 写坏（空回 / JSON 解析失败 / validate 抛错）同样换下一跳；两跳都不过返回 failure（业务友好文案，不回传上游原文）。
 */
async function runGoogleVisionTwoHop(input: {
  userId: number;
  op: string;
  area: string;
  domain: GeminiModelDomain;
  media: GoogleVisionMediaInput[];
  prompt: string;
  maxOutputTokens: number;
  temperature: number;
  timeoutMs?: number;
  validate?: (markdown: string) => void;
  mediaError: (index: number, error: unknown) => { status: number; body: Record<string, unknown> };
  failure: { status: number; body: Record<string, unknown> };
  context?: Record<string, unknown>;
}): Promise<GoogleVisionTwoHopOutcome> {
  const { geminiAudioJsonWithFallback, isManhuaDramaAudioAvailable } = await import("../server/gemini-audio");
  if (!isManhuaDramaAudioAvailable()) {
    return { ok: false, status: 500, body: { ok: false, error: "missing_env", message: "看图服务暂未配置，请稍后再试" } };
  }
  const bucket = getGcsBucketName();
  const prefix = `${input.area}/${input.userId}/${randomUUID()}`;
  const save = googleAudioEvidenceSaver(bucket, prefix);
  const staged: GoogleVisionStagedMedia[] = [];
  for (let i = 0; i < input.media.length; i += 1) {
    try {
      staged.push(await stageGoogleVisionMedia(input.userId, bucket, prefix, i, input.media[i]!));
    } catch (error) {
      return { ok: false, ...input.mediaError(i, error) };
    }
  }
  const model = resolveGeminiModel(input.domain);
  await save("request", {
    userId: input.userId,
    op: input.op,
    model,
    ...input.context,
    media: staged.map((m, i) => ({ kind: input.media[i]!.kind, gsUri: m.gsUri, mimeType: m.mimeType, via: m.via, bytes: m.bytes, sha256: m.sha256, label: input.media[i]!.label })),
  });
  try {
    const result = await geminiAudioJsonWithFallback<{ markdown: string }>({
      media: googleAudioTwoHopMedia(staged[0]!.gsUri),
      mediaLabel: input.media[0]!.label,
      extraMedia: staged.slice(1).map((m, i) => ({ mimeType: m.mimeType, ...googleAudioTwoHopMedia(m.gsUri), label: input.media[i + 1]!.label })),
      mimeType: staged[0]!.mimeType,
      model,
      prompt: `${input.prompt}\n\n${GOOGLE_VISION_MARKDOWN_WRAP}`,
      nativeSchema: GOOGLE_VISION_MARKDOWN_SCHEMA,
      schemaName: `${input.op}_markdown`,
      maxOutputTokens: input.maxOutputTokens,
      temperature: input.temperature,
      timeoutMs: input.timeoutMs,
      validate: decoded => {
        const raw = (decoded as { markdown?: unknown } | null)?.markdown;
        const markdown = typeof raw === "string" ? raw.trim() : "";
        if (!markdown) throw new Error("markdown 为空");
        input.validate?.(markdown);
        return { markdown };
      },
      save,
    });
    return { ok: true, markdown: result.value.markdown, staged };
  } catch {
    // 两跳拒因已逐跳落证据（hop-*-raw / rejected / hop-exhausted），这里不回传上游原文。
    console.warn(`[${input.op}] 两跳均未取得可用结果`, prefix);
    return { ok: false, ...input.failure };
  }
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  try{
    const q:any = req.query || {};
    const b:any = req.method==="POST" ? getBody(req) : {};
    const op = s(q.op || b.op).trim();
    if(!op) return res.status(400).json({ok:false,error:"missing_op"});

    if (op === "materialReadUrl") {
      const viewer = await resolveGoogleGatewayUser(req);
      if (!viewer) return res.status(401).json({ ok: false, error: "authentication_required" });
      const gcsUri = s(b.gcsUri || q.gcsUri || "").trim();
      const allowedBuckets = [
        process.env.GCS_USER_UPLOAD_BUCKET,
        process.env.GCS_PDF_EXPORT_BUCKET,
        process.env.GCS_BUCKET_NAME,
        process.env.GROWTH_CAMP_GCS_BUCKET,
        process.env.VERTEX_GCS_BUCKET,
        process.env.GOOGLE_CLOUD_STORAGE_BUCKET,
        "mv-studio-pro-vertex-video-temp",
      ];
      if (!isAllowedCanvasMaterialGcsUri(gcsUri, allowedBuckets)) {
        return res.status(403).json({ ok: false, error: "gcs_uri_not_allowed" });
      }
      try {
        await assertSongOperationMaterialRead(viewer.userId, gcsUri);
      } catch {
        return res.status(403).json({ ok: false, error: "song_material_not_available", message: "此歌曲产物尚未结算或不属于本人，请查询原任务" });
      }
      try {
        return res.status(200).json({ ok: true, gcsUri, url: signGsUriV4ReadUrl(gcsUri, 3600) });
      } catch (error: any) {
        return res.status(502).json({ ok: false, error: "sign_failed", message: error?.message || String(error) });
      }
    }

    /** Veo 与 Google Omni 已淘汰；旧客户端在触达上游前得到明确 410。 */
    if (isRetiredGoogleVideoOp(op)) {
      return res.status(410).json({
        ok: false,
        code: "GOOGLE_VIDEO_MODEL_RETIRED",
        error: "Veo 与 Google Omni 已下线，请改用当前成片引擎",
      });
    }
    if (op === "creativeNanoImage") {
      return res.status(410).json({
        ok: false,
        code: "CREATIVE_NANO_SYNC_REMOVED",
        error: "Creative Nano 同步入口已停用，请通过异步图片任务生成",
      });
    }
    if (isInternalGoogleMediaOp(op)) {
      const viewer = await resolveGoogleGatewayUser(req);
      if (!viewer) return res.status(401).json({ ok: false, error: "authentication_required" });
      if (!hasSupervisorRole(viewer.role)) {
        return res.status(403).json({ ok: false, error: "admin_or_supervisor_required" });
      }
    }

    const nanoForceInlineBase64 = /^(1|true|yes|on)$/i.test(s(q.inlineBase64 || b.inlineBase64));

    // ---------------- transcribeAudio（1110：存 GCS 用户前缀 → Gemini 3.8 Flash 两跳 Vertex gs:// → EvoLink 签名 https） ----------------
    if (op === "transcribeAudio") {
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed", message: "语音识别只接受 POST 请求" });
      const viewer = await resolveGoogleGatewayUser(req);
      if (!viewer) return res.status(401).json({ ok: false, error: "authentication_required", message: "请登录后再识别原音" });
      const audioBase64 = typeof b.audioBase64 === "string" ? b.audioBase64 : "";
      const mimeType = s(b.mimeType || "audio/webm").trim().toLowerCase().split(";")[0];
      if (!audioBase64) return res.status(400).json({ ok: false, error: "missing_audio", message: "没有收到音频" });
      if (!["audio/webm", "audio/mp4", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/flac", "audio/aac"].includes(mimeType))
        return res.status(415).json({ ok: false, error: "unsupported_audio_type", message: "音频格式不受支持" });
      // 先估算再解码；Buffer.from 的宽松行为不能放行损坏或超大的原音。
      const maxBytes = 8 * 1024 * 1024;
      const estimatedBytes = audioBase64.length / 4 * 3 - (audioBase64.endsWith("==") ? 2 : audioBase64.endsWith("=") ? 1 : 0);
      if (audioBase64.length > Math.ceil(maxBytes / 3) * 4 || estimatedBytes > maxBytes)
        return res.status(413).json({ ok: false, error: "audio_too_large", message: "语音识别每次最多接收 8 MB 音频，原音仍可直接用于视频" });
      if (audioBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audioBase64))
        return res.status(400).json({ ok: false, error: "invalid_audio_base64", message: "音频传输内容损坏，请重新选择原音" });
      const bytes = Buffer.from(audioBase64, "base64");
      if (!bytes.length || bytes.length > maxBytes || bytes.toString("base64") !== audioBase64)
        return res.status(400).json({ ok: false, error: "invalid_audio_base64", message: "音频传输内容损坏，请重新选择原音" });

      const requestId = randomUUID();
      try {
        const { isManhuaDramaVertexAudioAvailable, isManhuaDramaEvolinkAudioAvailable } = await import("../server/gemini-audio");
        if (!isManhuaDramaVertexAudioAvailable() && !isManhuaDramaEvolinkAudioAvailable())
          return res.status(500).json({ ok: false, error: "missing_env", message: "语音识别服务暂未配置，原音保留，可手动填写" });
        // 1110：两跳规格（temperature 0、按 12000 字合同估算 maxOutputTokens、STOP 与字数校验）与实测探针共用一处真源
        const { transcribeVoiceInputTwoHop } = await import("../server/_core/voiceTranscription");
        const bucket = getGcsBucketName();
        const prefix = `voice-transcribe/${viewer.userId}/${requestId}`;
        const save = googleAudioEvidenceSaver(bucket, prefix);
        const objectName = `${prefix}/audio.${googleAudioObjectExt(mimeType)}`;
        await uploadBufferToGcsIfAbsent({ bucket, objectName, buffer: bytes, contentType: mimeType });
        const audioGsUri = `gs://${bucket}/${objectName}`;
        await save("request", { userId: viewer.userId, op, mimeType, audioGsUri, audioBytes: bytes.length, audioSha256: createHash("sha256").update(bytes).digest("hex") });
        const out = await transcribeVoiceInputTwoHop({ audioGsUri, mimeType, save });
        // 拒因分类：两跳都失败时仍按原合同回错误码（不完整 422 / 不可用 422 / 上游失败 502）；拒因原文只在证据里。
        if (!out.ok) {
          console.warn("[transcribeAudio] 两跳均未取得完整转写", requestId);
          if (out.reason === "incomplete") return res.status(422).json({ ok: false, error: "transcription_incomplete", message: "识别结果不完整，未将截断文字作为全文，请缩短音频后重新确认" });
          if (out.reason === "unusable") return res.status(422).json({ ok: false, error: "transcription_unusable", message: "本次未取得可用完整文字，原音保留，可手动填写" });
          return res.status(502).json({ ok: false, error: "transcription_upstream_failed", message: "语音识别服务本次未成功，原音保留，请勿连续重试" });
        }
        await save("transcript", { channel: out.channel, model: out.model, failuresZh: out.failuresZh, text: out.text });
        return res.status(200).json({ ok: true, text: out.text });
      } catch {
        // 不回传原错误（可能含内部地址）；证据在 voice-transcribe/<userId>/<requestId>/。
        console.warn("[transcribeAudio] 转存或落证据失败", requestId);
        return res.status(502).json({ ok: false, error: "transcription_unavailable", message: "语音识别连接未完成，原音保留，请先确认本次结果" });
      }
    }

    // ---------------- 漫剧学习 A：GCS 签名上传 URL（本机 PUT，Fly 持 SA；须登录，对象落本人前缀） ----------------
    if (op === "manhuaAudioGetUploadUrl") {
      return issueManhuaLearnUploadUrl(req, res, {
        fileName: s(b.fileName || q.fileName || "learn-audio.mp3") || "learn-audio.mp3",
        mimeType: s(b.mimeType || q.mimeType || "audio/mpeg") || "audio/mpeg",
        subdir: "manhua-template-learn",
      });
    }

    // ---------------- 漫剧学习 A：听音扫描（1110：Gemini 3.8 Flash 两跳 Vertex gs:// → EvoLink 签名 https，不内联） ----------------
    if (op === "manhuaAudioClimaxScan") {
      const audioUrl = s(b.audioUrl || q.audioUrl).trim();
      const gcsUri = s(b.gcsUri || q.gcsUri).trim();
      const mimeType = s(b.mimeType || q.mimeType || "audio/mpeg") || "audio/mpeg";
      if (!audioUrl && !gcsUri) {
        return res.status(400).json({ ok: false, error: "missing_audioUrl_or_gcsUri" });
      }
      if (gcsUri && !/^gs:\/\/[^/]+\/.+/.test(gcsUri)) return res.status(400).json({ ok: false, error: "invalid_gcsUri" });
      // 转存与证据要放用户前缀下 → 先认人（原入口未鉴权）。
      const viewer = await resolveGoogleGatewayUser(req);
      if (!viewer) return res.status(401).json({ ok: false, error: "authentication_required" });
      // 防跨用户读取：gcsUri 只收本人对象，复用后期素材登记核验（本桶 uploads/u<uid>/、post-prod/<uid>/、
      // 本人成功任务产物、画布登记簿）；别人的、别的桶的、未登记的一律 403，不下载、不调模型。
      let ownedGsUri = "";
      if (gcsUri) {
        try {
          const { resolveRegisteredPostProdMediaSource } = await import("../server/services/postProdMediaSource");
          ownedGsUri = await resolveRegisteredPostProdMediaSource({ userId: String(viewer.userId), source: gcsUri });
        } catch {
          return res.status(403).json({ ok: false, error: "gcs_uri_not_allowed", message: "素材不属于本人或尚未登记" });
        }
      }
      try {
        // 提示词 / schema / 结果整形与 gemini-audio.ts 一处真源（不再在本文件抄一份）
        const { geminiAudioJsonWithFallback, resolveGeminiAudioTwoHopModel, MANHUA_AUDIO_SCAN_PROMPT, MANHUA_AUDIO_SCAN_SCHEMA, normalizeManhuaAudioScan } = await import("../server/gemini-audio");
        const bucket = getGcsBucketName();
        const prefix = `manhua-template-learn/audio-scan/${viewer.userId}/${randomUUID()}`;
        const save = googleAudioEvidenceSaver(bucket, prefix);
        // 有 gcsUri（已核验为本人对象）直接用；只有 audioUrl 时 Fly 代下后转存到本人前缀下
        let mediaGsUri = ownedGsUri;
        let fetched: { audioBytes: number; audioSha256: string } | undefined;
        if (!mediaGsUri) {
          const buffer = await fetchManhuaScanAudio(audioUrl);
          const objectName = `${prefix}/source.${googleAudioObjectExt(mimeType)}`;
          await uploadBufferToGcsIfAbsent({ bucket, objectName, buffer, contentType: mimeType });
          mediaGsUri = `gs://${bucket}/${objectName}`;
          fetched = { audioBytes: buffer.length, audioSha256: createHash("sha256").update(buffer).digest("hex") };
        }
        await save("request", { userId: viewer.userId, op, via: gcsUri ? "gcs" : "audioUrl", mediaGsUri, mimeType, ...fetched });
        const result = await geminiAudioJsonWithFallback({
          media: googleAudioTwoHopMedia(mediaGsUri),
          audioTimestamp: true,
          model: resolveGeminiAudioTwoHopModel(),
          mimeType,
          prompt: MANHUA_AUDIO_SCAN_PROMPT,
          nativeSchema: MANHUA_AUDIO_SCAN_SCHEMA,
          schemaName: "manhua_drama_audio_scan",
          validate: normalizeManhuaAudioScan,
          save,
        });
        // model 写法同原函数：`vertex/<模型>` 或 `evolink/<模型>`
        const scan = { model: `${result.channel.toLowerCase()}/${result.model}`, ...result.value };
        await save("scan", { channel: result.channel, failuresZh: result.failuresZh, ...scan });
        return res.status(200).json({
          ok: true,
          model: scan.model,
          language: scan.language,
          transcriptSummary: scan.transcriptSummary,
          sections: scan.sections,
          via: gcsUri ? "gcs" : "audioUrl",
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[manhuaAudioClimaxScan]", msg.slice(0, 400));
        return res.status(500).json({ ok: false, error: "manhua_audio_scan_failed", detail: msg.slice(0, 280) });
      }
    }

    // ---------------- 漫剧学习：关键帧 GCS 签名上传（本机 PUT，Fly 持 SA；须登录，对象落本人前缀） ----------------
    if (op === "manhuaTemplateFrameGetUploadUrl") {
      return issueManhuaLearnUploadUrl(req, res, {
        fileName: s(b.fileName || q.fileName || "learn-frame.jpg") || "learn-frame.jpg",
        mimeType: s(b.mimeType || q.mimeType || "image/jpeg") || "image/jpeg",
        subdir: "manhua-template-learn/frames",
      });
    }

    // ---------------- 漫剧学习：GCS/URL/dataUrl 关键帧 → GPT-5.6 Terra（high）补全提案字段 ----------------
    if (op === "manhuaTemplateFrameScan") {
      const rawFrames = Array.isArray(b.frames) ? b.frames : [];
      const frames = rawFrames
        .map((item: { atSec?: unknown; dataUrl?: unknown; url?: unknown; gcsUri?: unknown; mimeType?: unknown }) => ({
          atSec: Math.max(0, Number(item?.atSec) || 0),
          dataUrl: s(item?.dataUrl).trim(),
          url: s(item?.url).trim(),
          gcsUri: s(item?.gcsUri).trim(),
          mimeType: s(item?.mimeType || "image/jpeg").trim() || "image/jpeg",
        }))
        .filter((item: { dataUrl: string; url: string; gcsUri: string }) => item.dataUrl || item.url || item.gcsUri)
        .slice(0, 32);
      if (!frames.length) return res.status(400).json({ ok: false, error: "missing_frames" });
      try {
        const { analyzeManhuaTemplateFramesWithTerra } = await import("../server/manhuaTemplateFrameVision");
        const {
          MANHUA_TEMPLATE_FRAME_VISION_MODEL,
          MANHUA_TEMPLATE_FRAME_VISION_REASONING,
        } = await import("../shared/manhuaTemplateLearnFrameVision");
        const vision = await analyzeManhuaTemplateFramesWithTerra({
          frames,
          titleHint: s(b.titleHint || b.title || ""),
          durationSec: Number(b.durationSec),
          transcriptPreview: s(b.transcriptPreview || ""),
          climaxNotes: Array.isArray(b.climaxNotes)
            ? b.climaxNotes.map((x: unknown) => s(x).trim()).filter(Boolean)
            : [],
          fallbackLane: s(b.fallbackLane || "爽文逆袭") || "爽文逆袭",
        });
        return res.status(200).json({
          ok: true,
          model: vision.model || MANHUA_TEMPLATE_FRAME_VISION_MODEL,
          reasoningEffort: vision.reasoningEffort || MANHUA_TEMPLATE_FRAME_VISION_REASONING,
          vision,
          frameCount: frames.length,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[manhuaTemplateFrameScan]", msg.slice(0, 400));
        return res.status(500).json({ ok: false, error: "manhua_frame_scan_failed", detail: msg.slice(0, 280) });
      }
    }

    // 旧高清放大兼容入口只供管理员/监管调试。正式用户入口必须走受保护且扣费的 tRPC/jobs。
    // 放在全局 Vertex token 初始化之前：统一 fallback 不应被无关的 Vertex 配置提前阻断。
    if (op === "upscaleImage") {
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
      const viewer = await resolveGoogleGatewayUser(req);
      if (!viewer) return res.status(401).json({ ok: false, error: "authentication_required" });
      const imageUrl = s(b.imageUrl || "").trim();
      if (!imageUrl) return res.status(400).json({ ok: false, error: "missing_image_url" });
      const access = validateLegacyUpscaleAccess({
        method: req.method,
        role: viewer.role,
        upscaleFactor: s(b.upscaleFactor || ""),
      });
      if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });
      const result = await runVertexUpscaleImage({
        imageUrl,
        upscaleFactor: access.upscaleFactor,
      });
      return res.status(result.ok ? 200 : 502).json(result);
    }

    // ---------------- Canvas / 工作流：视频反推提示词（帧序列；1110 起存 GCS → Gemini 两跳，不内联） ----------------
    if (op === "videoReversePrompt") {
      const {
        VIDEO_REVERSE_SYSTEM_PROMPT,
        buildVideoReverseUserPrompt,
        parseVideoReverseOutputMode,
      } = await import("../shared/videoReversePrompt");
      const userHint = s(b.userHint || b.prompt || q.prompt || "");
      const outputMode = parseVideoReverseOutputMode(b.outputMode || q.outputMode || b.locale || q.locale);
      const legacyUrls = Array.isArray(b.imageUrls)
        ? b.imageUrls.map((u: unknown) => s(u).trim()).filter(Boolean)
        : [];
      const rawImages = Array.isArray(b.images) ? b.images : legacyUrls.map((url: string) => ({ url }));
      const images = rawImages
        .map((item: { url?: unknown; gcsUri?: unknown; mimeType?: unknown; dataUrl?: unknown }) => ({
          url: s(item?.url || item?.dataUrl).trim(),
          gcsUri: s(item?.gcsUri).trim(),
          mimeType: s(item?.mimeType || "image/jpeg").trim() || "image/jpeg",
        }))
        .filter((item: { url: string; gcsUri: string }) => item.url || item.gcsUri)
        .slice(0, 32);
      if (!images.length) return res.status(400).json({ ok: false, error: "missing_frames" });
      // 帧要落本人前缀并留证据 → 先认人（原入口未鉴权）。
      const viewer = await resolveGoogleGatewayUser(req);
      if (!viewer) return res.status(401).json({ ok: false, error: "authentication_required" });

      const outcome = await runGoogleVisionTwoHop({
        userId: viewer.userId,
        op,
        area: "canvas-vision/video-reverse",
        domain: "canvasVision",
        media: images.map((item: { url: string; gcsUri: string; mimeType: string }, i: number) => ({
          kind: "image" as const,
          ...item,
          label: `帧 ${i + 1}/${images.length}`,
        })),
        prompt: [
          VIDEO_REVERSE_SYSTEM_PROMPT,
          "",
          buildVideoReverseUserPrompt({
            userHint,
            outputMode,
            targetEngine: s(b.targetEngine || "seedance-2.0") === "generic" ? "generic" : "seedance-2.0",
          }),
          "",
          `（共 ${images.length} 帧，按时间顺序）`,
        ].join("\n"),
        maxOutputTokens: 65536,
        temperature: 0.35,
        timeoutMs: 240_000,
        context: { outputMode, frameCount: images.length },
        mediaError: (i, error) =>
          error instanceof GoogleVisionMediaError && error.status !== 502
            ? { status: error.status, body: { ok: false, error: error.code, message: error.message } }
            : {
                status: 502,
                body: { ok: false, error: "frame_fetch_failed", message: `无法读取第 ${i + 1} 帧（${error instanceof Error ? error.message : String(error)}）` },
              },
        failure: { status: 502, body: { ok: false, error: "video_reverse_failed", message: "视频反推暂不可用，请稍后重试" } },
      });
      if (!outcome.ok) return res.status(outcome.status).json(outcome.body);
      return res.status(200).json({ ok: true, markdown: outcome.markdown, frameCount: images.length });
    }

    // ---------------- 漫剧成片：首镜 + 完整视频智能质检（1110 起存 GCS → Gemini 两跳，不内联） ----------------
    if (op === "manhuaClipQualityReview") {
      const referenceImageUrl = s(b.referenceImageUrl || "").trim();
      const videoUrl = s(b.videoUrl || "").trim();
      const expectedContext = s(b.expectedContext || "").trim();
      const expectedDurationSec = Number(b.expectedDurationSec);
      const shotIndex = Number(b.shotIndex);
      if (!referenceImageUrl) return res.status(400).json({ ok: false, error: "missing_reference_image" });
      if (!videoUrl) return res.status(400).json({ ok: false, error: "missing_video" });
      const viewer = await resolveGoogleGatewayUser(req);
      if (!viewer) return res.status(401).json({ ok: false, error: "authentication_required" });

      const qualityPrompt = buildManhuaClipQualityPrompt({
        expectedContext,
        expectedDurationSec: Number.isFinite(expectedDurationSec) ? expectedDurationSec : undefined,
        shotIndex: Number.isFinite(shotIndex) && shotIndex >= 1 ? shotIndex : undefined,
      });
      const outcome = await runGoogleVisionTwoHop({
        userId: viewer.userId,
        op,
        area: "manhua-clip-quality",
        domain: "clipQualityReview",
        media: [
          { kind: "image", url: referenceImageUrl, mimeType: "image/jpeg", label: "第1项：本镜关键静帧" },
          { kind: "video", url: videoUrl, mimeType: "video/mp4", label: "第2项：本镜生成成片" },
        ],
        prompt: qualityPrompt,
        maxOutputTokens: 8192,
        temperature: 0.1,
        context: { shotIndex: Number.isFinite(shotIndex) ? shotIndex : undefined, expectedDurationSec: Number.isFinite(expectedDurationSec) ? expectedDurationSec : undefined },
        // 写坏：七项判定任一缺 YES/NO 即换下一跳（不把缺项当 NO 判失败）。
        validate: markdown => {
          const missing = MANHUA_CLIP_QUALITY_KEYS.filter(key => {
            const name = key === "DURATION_OK" ? "(?:DURATION_OK|DURATION_10S)" : key;
            return !new RegExp(`(?:^|\\n)\\s*${name}\\s*=\\s*(?:YES|NO)\\b`, "i").test(markdown);
          });
          if (missing.length) throw new Error(`质检项缺失：${missing.join("、")}`);
        },
        mediaError: (_i, error) => ({
          status: 502,
          body: { ok: false, error: "quality_media_fetch_failed", message: error instanceof Error ? error.message : String(error) },
        }),
        failure: { status: 502, body: { ok: false, error: "quality_review_failed" } },
      });
      if (!outcome.ok) return res.status(outcome.status).json(outcome.body);
      return res.status(200).json({
        ok: true,
        report: parseManhuaClipQualityMarkdown(outcome.markdown),
        media: { imageBytes: outcome.staged[0]?.bytes, videoBytes: outcome.staged[1]?.bytes },
      });
    }

    // ---------------- Canvas：多图视觉 → Markdown（1110 起存 GCS → Gemini 两跳，不内联） ----------------
    if (op === "canvasVisionMarkdown") {
      const prompt = s(b.prompt || q.prompt || "");
      const legacyUrls = Array.isArray(b.imageUrls)
        ? b.imageUrls.map((u: unknown) => s(u).trim()).filter(Boolean)
        : [];
      const rawImages = Array.isArray(b.images) ? b.images : legacyUrls.map((url: string) => ({ url }));
      const images = rawImages
        .map((item: { url?: unknown; gcsUri?: unknown; mimeType?: unknown }) => ({
          url: s(item?.url).trim(),
          gcsUri: s(item?.gcsUri).trim(),
          mimeType: s(item?.mimeType || "image/jpeg").trim() || "image/jpeg",
        }))
        .filter((item: { url: string; gcsUri: string }) => item.url || item.gcsUri);
      if (!prompt) return res.status(400).json({ ok: false, error: "missing_prompt" });
      if (!images.length) return res.status(400).json({ ok: false, error: "missing_image_urls" });
      const viewer = await resolveGoogleGatewayUser(req);
      if (!viewer) return res.status(401).json({ ok: false, error: "authentication_required" });

      const outcome = await runGoogleVisionTwoHop({
        userId: viewer.userId,
        op,
        area: "canvas-vision/markdown",
        domain: "canvasVision",
        media: images.map((item: { url: string; gcsUri: string; mimeType: string }) => ({ kind: "image" as const, ...item })),
        prompt: [prompt, "", `（共 ${images.length} 张图）`, "请输出 Markdown，不要多余解释。"].join("\n"),
        maxOutputTokens: 65536,
        temperature: 0.4,
        timeoutMs: 240_000,
        context: { imageCount: images.length },
        mediaError: (_i, error) =>
          error instanceof GoogleVisionMediaError && error.status !== 502
            ? { status: error.status, body: { ok: false, error: error.code, message: error.message } }
            : {
                status: 502,
                body: {
                  ok: false,
                  error: "image_fetch_failed",
                  message: `无法读取参考图（${error instanceof Error ? error.message : String(error)}）。请改用画布内已上传的素材 URL，或重新上传后再试。`,
                },
              },
        failure: { status: 502, body: { ok: false, error: "vision_failed", message: "图片分析暂不可用，请稍后重试" } },
      });
      if (!outcome.ok) return res.status(outcome.status).json(outcome.body);
      return res.status(200).json({ ok: true, markdown: outcome.markdown, imageCount: images.length });
    }

    const projectId = s(process.env.VERTEX_PROJECT_ID).trim();
    if(!projectId) return res.status(500).json({ok:false,error:"missing_env",detail:"VERTEX_PROJECT_ID"});

    const token = await getVertexAccessToken();

    // ---------------- Gemini (text) · Vertex IAM only（Bearer；禁止 Gemini API 直连密钥） ----------------
    if(op === "geminiScript"){
      const prompt = s(b.prompt || q.prompt || "");
      if(!prompt) return res.status(400).json({ok:false,error:"missing_prompt"});

      const location = (s(process.env.VERTEX_GEMINI_LOCATION) || "global").trim();
      const model = (s(b.model || q.model || "") || s(process.env.VERTEX_GEMINI_MODEL) || "gemini-3.1-pro-preview").trim();
      const is31Pro = /gemini-3\.1.*pro/i.test(model);
      const is25Pro = /gemini-2\.5/i.test(model) && /pro/i.test(model) && !/flash/i.test(model);
      const is3Flash =
        (/^gemini-3-flash/i.test(model) || /^gemini-3(?!\.1).*flash/i.test(model)) &&
        !/gemini-3\.1/i.test(model) &&
        !/image/i.test(model);
      const generationConfig = is31Pro
        ? {
            maxOutputTokens: 65536,
            temperature: 0.9,
            topP: 0.95,
            thinkingConfig: { includeThoughts: false, thinkingLevel: "HIGH" },
          }
        : is25Pro || is3Flash
          ? {
              maxOutputTokens: 32768,
              temperature: 0.8,
              topP: 0.95,
              thinkingConfig: { includeThoughts: false, thinkingLevel: "HIGH" },
            }
          : { maxOutputTokens: 8192, temperature: 0.9 };

      const base = baseUrlFor(location);
      const url = `${base}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
      const body = JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      });

      let r = await fetchJson(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body,
      });
      for (let attempt = 0; attempt < 3 && !r.ok && shouldRetryVertexText(r.status, r.json, r.rawText); attempt += 1) {
        await sleep(900 * (attempt + 1));
        r = await fetchJson(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body,
        });
      }

      // 角色卡等 Pro 文本历史上易 503：同请求内换 Flash 再试（不向外泄漏模型名）
      if (!r.ok && shouldRetryVertexText(r.status, r.json, r.rawText)) {
        const { resolveGeminiScriptFallbackModel } = await import("../shared/geminiScriptFallback");
        const fallbackModel = resolveGeminiScriptFallbackModel(model);
        if (fallbackModel && fallbackModel !== model) {
          const fbUrl = `${base}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${fallbackModel}:generateContent`;
          const fbBody = JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: 32768,
              temperature: 0.8,
              topP: 0.95,
              thinkingConfig: { includeThoughts: false, thinkingLevel: "HIGH" },
            },
          });
          for (let attempt = 0; attempt < 2; attempt += 1) {
            if (attempt > 0) await sleep(1100 * attempt);
            r = await fetchJson(fbUrl, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: fbBody,
            });
            if (r.ok || !shouldRetryVertexText(r.status, r.json, r.rawText)) break;
          }
        }
      }

      const raw = r.json ?? r.rawText;
      const httpOut = r.ok ? 200 : r.status === 429 ? 429 : r.status === 503 ? 503 : 502;
      return res.status(httpOut).json({
        ok: r.ok,
        status: r.status,
        url: r.url,
        raw,
        error: r.ok ? undefined : "算力紧张，请稍后重试",
      });
    }

    // ---------------- Vertex：TestLab 翻译（gemini-3-flash-preview · locations/global；与 geminiScript 同为 IAM REST） ----------------
    if (op === "vertexTranslate") {
      const sourceText = s(b.prompt || b.text || q.prompt || "").trim();
      if (!sourceText) return res.status(400).json({ ok: false, error: "missing_prompt" });

      const targetLang = s(b.targetLang || q.targetLang || "English").trim() || "English";
      const model = "gemini-3-flash-preview";
      const instruction =
        `You are a professional translator. Translate the user text into ${targetLang}. ` +
        "Preserve meaning and tone. Output ONLY the translation, with no preamble or markdown.";
      const userPayload = `---\n${sourceText}`;
      const bodyStr = JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${instruction}\n\n${userPayload}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
      });

      const location = "global" as const;
      const base = baseUrlFor(location);
      const url = `${base}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
      const r = await fetchJson(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: bodyStr,
      });

      const raw = r.json ?? r.rawText;
      const parts = Array.isArray((raw as any)?.candidates?.[0]?.content?.parts)
        ? (raw as any).candidates[0].content.parts
        : [];
      const translated = parts.map((p: any) => s(p?.text)).join("").trim();

      return res.status(r.ok ? 200 : 502).json({
        ok: r.ok,
        status: r.status,
        url: r.url,
        model,
        location,
        targetLang,
        translated: translated || null,
        raw,
      });
    }

    // ---------------- Nano Banana (image) ----------------
    // op=nanoImage, tier=flash|pro, size=1K|2K|4K, aspectRatio=16:9...
    // Pro · 4K：imageConfig.imageSize + outputResolution（產品文檔口徑）；Flash 僅在 2K/4K 時寫 imageSize。
    // fetch 一律 120s：4K Base64 體量大可導致讀取超時。
    /**
     * 八审 P0-1:Nano 生图有两个 op——
     * - creativeNanoImage:Creative 页付费产品。强制登录、服务端锁死 Flash/1K/model,
     *   客户端的 model/tier/size 一律忽略(旧版可传 Pro/4K 却只扣 35 的错价洞),
     *   扣 35 走 runPaidWorkflowStep,失败原路退。
     * - nanoImage(裸):曾是公网免登录免扣费旁门(省略 billing 即免费打付费上游)。
     *   收口为内部专用:强制登录 + supervisor/admin,普通/匿名一律 403。
     */
    if(op === "nanoImage"){
      const prompt = s(b.prompt || q.prompt || "");
      if(!prompt) return res.status(400).json({ok:false,error:"missing_prompt"});

      const tier = s(b.tier || q.tier || "flash").toLowerCase(); // flash|pro
      const size = s(b.imageSize || q.imageSize || "1K").toUpperCase(); // 1K|2K|4K
      const aspectRatio = s(b.aspectRatio || q.aspectRatio || "16:9");
      const negativePrompt = s(b.negativePrompt || q.negativePrompt || "");
      const guidanceScale = Number(b.guidanceScale || q.guidanceScale || 0);
      const seed = q.seed != null || b.seed != null ? Number(b.seed || q.seed) : undefined;
      const personGeneration = s(b.personGeneration || q.personGeneration || "");

      const rawModel = s(b.model || q.model || "");

      const resolvedTier = rawModel
        ? (
            rawModel === "gemini-3-pro-image-001" ||
            rawModel === "gemini-3-pro-image-preview"
          )
          ? "pro"
          : "flash"
        : tier;

      const model = rawModel
        ? rawModel
        : resolvedTier === "pro"
          ? s(process.env.VERTEX_IMAGE_MODEL_PRO || "gemini-3-pro-image-preview")
          : s(process.env.VERTEX_IMAGE_MODEL_FLASH || "gemini-3.1-flash-image");

      const location = resolvedTier === "pro"
        ? (s(process.env.VERTEX_IMAGE_LOCATION_PRO || process.env.VERTEX_IMAGE_LOCATION) || "global").trim()
        : (s(process.env.VERTEX_IMAGE_LOCATION_FLASH || process.env.VERTEX_IMAGE_LOCATION) || "global").trim();
      const base = baseUrlFor(location);
      const url = `${base}/v1beta1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

      const imageConfig:any = { aspectRatio };
      if(Number.isFinite(seed as number)) imageConfig.seed = Math.floor(seed as number);
      if(personGeneration) imageConfig.personGeneration = personGeneration;
      if (resolvedTier === "pro") {
        imageConfig.imageSize = size;
        if (size === "4K") imageConfig.outputResolution = "4K";
      } else if (size === "2K" || size === "4K") {
        imageConfig.imageSize = size;
      }

      const nanoVertexTimeoutMs = 120_000;
      const makeNanoVertexInit = (): RequestInit => ({
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig },
        }),
        signal: AbortSignal.timeout(nanoVertexTimeoutMs),
      });

      const generateNanoOnce = async () => {
        let r = await fetchJson(url, makeNanoVertexInit());
        for (let attempt = 0; attempt < 4 && shouldRetryVertexImage(r.status, r.json, r.rawText); attempt += 1) {
          await sleep((2 ** attempt) * 1000 + Math.floor(Math.random() * 300));
          r = await fetchJson(url, makeNanoVertexInit());
        }
        const raw = r.json ?? r.rawText;
        const images = r.ok ? extractGeneratedImages(r.json) : [];
        const imageUrls = images.map((item) => `data:${item.mimeType};base64,${item.data}`);
        const bodyNb = await buildNanoImageResponseBody({
          ok: r.ok,
          status: r.status,
          model,
          url: r.url,
          raw,
          imageUrls,
          forceInlineBase64: nanoForceInlineBase64,
        });
        return { ok: r.ok, status: r.status, imageUrls, bodyNb };
      };

      const result = await generateNanoOnce();
      return res.status(result.ok ? 200 : 502).json(result.bodyNb);
    }

    return res.status(400).json({ok:false,error:"unknown_op",op});
  }catch(e:any){
    return res.status(500).json({ok:false,error:"server_error",message:e?.message||String(e)});
  }
}
