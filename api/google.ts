import type { VercelRequest, VercelResponse } from "@vercel/node";
import { put } from "@vercel/blob";
import { getVertexAccessToken } from "../server/utils/vertex";
import { runVertexUpscaleImage, type VertexUpscaleResult } from "../server/services/vertexImage";
import { uploadBufferToGcs, signGsUriV4ReadUrl } from "../server/services/gcs";
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
 * - op=nanoImage       Vertex **`generateContent` 圖像**：**Nano Banana 2**（Flash）/ **Nano Banana Pro**；**不再**提供 Imagen `:predict` 生圖。若請求帶舊版 `imagen-4.0*`（或 `GEMINI_IMAGEN_ULTRA_MODEL` 別名）**自動改走** Nano Banana 2（Flash、Vertex IAM）。回傳預設將 `data:` 落地 GCS 簽名 URL。詳見程式內 `nanoImage` 分支。
 * - op=veoCreate       (Veo create)
 * - op=veoTask         (Veo polling)
 * - op=translateForVeo (Chinese → Veo-native English audio prompt)
 *
 * Env:
 * - **Vertex IAM（`generateContent` 圖像、Gemini Script、Veo 等 `aiplatform` 呼叫）**：`GOOGLE_APPLICATION_CREDENTIALS_JSON` **或** `GOOGLE_APPLICATION_CREDENTIALS`（金鑰檔路徑）；換取短效 **Bearer token**，**非** URL `?key=`。
 * - GEMINI_API_KEY：僅 **Consumer** `generativelanguage`（transcribeAudio、translateForVeo）；**不**用於 Vertex 圖像。
 * - VERTEX_PROJECT_ID（Vertex 圖像 / geminiScript / Veo 等必填；可另備 GOOGLE_CLOUD_PROJECT）
 * - VERTEX_IMAGEN_LOCATION（可選；**本閘道生圖已不再走 Imagen**，保留僅為歷史 env 相容）
 * - VERTEX_IMAGE_MODEL_FLASH / VERTEX_IMAGE_MODEL_PRO
 * - VERTEX_VEO_MODEL_RAPID / VERTEX_VEO_MODEL_PRO
 * - VERTEX_VIDEO_LOCATION_RAPID / VERTEX_VIDEO_LOCATION_PRO
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

function baseUrlFor(location:string){
  return location==="global" ? "https://aiplatform.googleapis.com" : `https://${location}-aiplatform.googleapis.com`;
}

function getPublicAssetBaseUrl() {
  return String(process.env.OAUTH_SERVER_URL || "").trim() || "https://mvstudiopro.fly.dev";
}

function buildBlobMediaUrlFromPath(pathname: string) {
  const normalized = String(pathname || "").replace(/^\/+/, "").trim();
  return `${getPublicAssetBaseUrl()}/api/jobs?op=blobMedia&blobPath=${encodeURIComponent(normalized)}`;
}

function extractVideoUrl(raw:any): string {
  const candidates = [
    raw?.response?.generatedVideos?.[0]?.video?.uri,
    raw?.response?.generatedVideos?.[0]?.video?.url,
    raw?.response?.videos?.[0]?.uri,
    raw?.response?.videos?.[0]?.url,
    raw?.generatedVideos?.[0]?.video?.uri,
    raw?.generatedVideos?.[0]?.video?.url,
    raw?.videoUrl,
    raw?.url,
  ];
  for (const item of candidates) {
    const v = s(item).trim();
    if (v) return v;
  }
  return "";
}

function extractGeneratedVideo(raw:any): { data: string; mimeType: string } | null {
  const candidates = [
    raw?.response?.generatedVideos?.[0]?.video,
    raw?.response?.videos?.[0],
    raw?.generatedVideos?.[0]?.video,
    raw?.videos?.[0],
  ];

  for (const item of candidates) {
    const data = s(item?.bytesBase64Encoded || item?.bytesBase64EncodedVideo || item?.videoBytes).trim();
    if (data) {
      return {
        data,
        mimeType: s(item?.mimeType || "video/mp4").trim() || "video/mp4",
      };
    }
  }

  return null;
}

async function materializeGeneratedVideo(taskId: string, raw:any) {
  const extracted = extractGeneratedVideo(raw);
  if (!extracted) return { videoUrl: "", materialized: false };

  const token = s(process.env.MVSP_READ_WRITE_TOKEN).trim();
  if (!token) {
    return {
      videoUrl: `data:${extracted.mimeType};base64,${extracted.data}`,
      materialized: false,
    };
  }

  const safeTaskId = s(taskId).split("/").pop() || `veo-${Date.now()}`;
  const extension = extracted.mimeType.includes("quicktime")
    ? "mov"
    : extracted.mimeType.includes("webm")
      ? "webm"
      : "mp4";

  const blob = await put(`videos/${Date.now()}-${safeTaskId}.${extension}`, Buffer.from(extracted.data, "base64"), {
    access: "public",
    token,
    contentType: extracted.mimeType,
  });

  return {
    videoUrl: buildBlobMediaUrlFromPath(String(blob.pathname || "")),
    materialized: true,
  };
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

function normalizePredictOperationName(taskIdOrName: string, projectId: string, location: string, model: string): string {
  const input = s(taskIdOrName).trim();
  if (!input) return "";
  if (input.startsWith(`projects/${projectId}/locations/${location}/publishers/google/models/${model}/operations/`)) return input;
  const m = input.match(/operations\/([^/?\s]+)/);
  if (m?.[1]) return `projects/${projectId}/locations/${location}/publishers/google/models/${model}/operations/${m[1]}`;
  return `projects/${projectId}/locations/${location}/publishers/google/models/${model}/operations/${input}`;
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

async function sleep(ms:number){
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** 舊 Imagen 4 `imagen-4.0*` 前綴，或與 `GEMINI_IMAGEN_ULTRA_MODEL` **完全一致**的別名 → 由 `nanoImage` 強制 remap。 */
function isLegacyImagenModelId(rawModel: string): boolean {
  const m = s(rawModel).trim();
  if (!m) return false;
  const alias = s(process.env.GEMINI_IMAGEN_ULTRA_MODEL || "").trim();
  if (alias.length > 0 && m === alias) return true;
  return m.toLowerCase().startsWith("imagen-4.0");
}

/** 舊 `:predict` 文生圖 ID 攔截後 **固定**使用的 Nano Banana 2（與 `VERTEX_IMAGE_MODEL_FLASH` 預設一致）。 */
const LEGACY_IMAGEN_REMAP_TARGET_MODEL = "gemini-3.1-flash-image-preview";

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

async function fetchImageAsBase64(imageUrl:string){
  const url = s(imageUrl).trim();
  if(!url) throw new Error("missing_image_url");

  const dataMatch = url.match(/^data:([^;,]+);base64,(.+)$/);
  if (dataMatch?.[1] && dataMatch?.[2]) {
    const mimeType = String(dataMatch[1] || "image/png");
    const b64 = String(dataMatch[2] || "").trim();
    const buf = Buffer.from(b64, "base64");
    if(!buf.length) throw new Error("empty_image");
    if(buf.length > 10*1024*1024) throw new Error("image_too_large");
    return { mimeType, b64, bytes: buf.length };
  }

  const token = s(process.env.BLOB_READ_WRITE_TOKEN).trim();
  const headers:any = { "User-Agent":"mvstudiopro/1.0 (+google-fetch)" };

  let r = await fetch(url, { redirect:"follow", headers });
  if (r.status===403 && token){
    headers["Authorization"] = `Bearer ${token}`;
    r = await fetch(url, { redirect:"follow", headers });
  }
  if(!r.ok) throw new Error("image_fetch_failed:"+r.status);

  const mimeType = String(r.headers.get("content-type") || "image/png");
  const buf = Buffer.from(await r.arrayBuffer());
  if(!buf.length) throw new Error("empty_image");
  if(buf.length > 10*1024*1024) throw new Error("image_too_large");
  return { mimeType, b64: buf.toString("base64"), bytes: buf.length };
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  try{
    const q:any = req.query || {};
    const b:any = req.method==="POST" ? getBody(req) : {};
    const op = s(q.op || b.op).trim();
    if(!op) return res.status(400).json({ok:false,error:"missing_op"});

    const nanoForceInlineBase64 = /^(1|true|yes|on)$/i.test(s(q.inlineBase64 || b.inlineBase64));

    // ---------------- transcribeAudio (Gemini direct, no Vertex needed) ----------------
    if (op === "transcribeAudio") {
      const audioBase64 = s(b.audioBase64 || "");
      const mimeType = s(b.mimeType || "audio/webm");
      if (!audioBase64) return res.status(400).json({ ok: false, error: "missing_audio" });

      const geminiApiKey = s(process.env.GEMINI_API_KEY).trim();
      if (!geminiApiKey) return res.status(500).json({ ok: false, error: "missing_env", detail: "GEMINI_API_KEY" });

      const model = "gemini-3.1-flash-lite-preview";
      const body = {
        contents: [{
          parts: [
            { text: "请将以下音频内容转录为文字。只输出转录文字，不要任何解释。" },
            { inlineData: { mimeType, data: audioBase64 } }
          ]
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 1024 }
      };

      const r = await fetchJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );

      if (!r.ok) return res.status(200).json({ ok: true, text: "", fallback: true });
      const text = (r.json?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      return res.status(200).json({ ok: true, text });
    }

    const projectId = s(process.env.VERTEX_PROJECT_ID).trim();
    if(!projectId) return res.status(500).json({ok:false,error:"missing_env",detail:"VERTEX_PROJECT_ID"});

    const token = await getVertexAccessToken();

    // ---------------- Gemini (text) ----------------
    if(op === "geminiScript"){
      const prompt = s(b.prompt || q.prompt || "");
      if(!prompt) return res.status(400).json({ok:false,error:"missing_prompt"});

      const location = (s(process.env.VERTEX_GEMINI_LOCATION) || "global").trim();
      const model = (s(process.env.VERTEX_GEMINI_MODEL) || "gemini-3.1-pro-preview").trim();
      const base = baseUrlFor(location);
      const url = `${base}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

      const r = await fetchJson(url,{
        method:"POST",
        headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" },
        body: JSON.stringify({ contents:[{role:"user",parts:[{text:prompt}]}] })
      });

      const raw = r.json ?? r.rawText;
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, url:r.url, raw });
    }

    // ---------------- Nano Banana (image) ----------------
    // 舊 Imagen `imagen-4.0*` / GEMINI_IMAGEN_ULTRA_MODEL 別名 → 強制 LEGACY_IMAGEN_REMAP_TARGET_MODEL，JSON 附 remappedFromLegacyImagen。
    // op=nanoImage, tier=flash|pro, size=1K|2K|4K, aspectRatio=16:9...
    // Pro · 4K：imageConfig.imageSize + outputResolution（產品文檔口徑）；Flash 僅在 2K/4K 時寫 imageSize。
    // fetch 一律 120s：4K Base64 體量大可導致讀取超時。
    if(op === "nanoImage"){
      const prompt = s(b.prompt || q.prompt || "");
      if(!prompt) return res.status(400).json({ok:false,error:"missing_prompt"});

      const tier = s(b.tier || q.tier || "flash").toLowerCase(); // flash|pro
      const size = s(b.imageSize || q.imageSize || "1K").toUpperCase(); // 1K|2K|4K
      const aspectRatio = s(b.aspectRatio || q.aspectRatio || "16:9");
      const negativePrompt = s(b.negativePrompt || q.negativePrompt || "");
      const numberOfImages = Math.max(1, Math.min(4, Number(b.numberOfImages || q.numberOfImages || 1) || 1));
      const guidanceScale = Number(b.guidanceScale || q.guidanceScale || 0);
      const seed = q.seed != null || b.seed != null ? Number(b.seed || q.seed) : undefined;
      const personGeneration = s(b.personGeneration || q.personGeneration || "");

      let rawModel = s(b.model || q.model || "");
      const legacyImagenRemap = isLegacyImagenModelId(rawModel);
      if (legacyImagenRemap) {
        rawModel = LEGACY_IMAGEN_REMAP_TARGET_MODEL;
      }

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
          : s(process.env.VERTEX_IMAGE_MODEL_FLASH || "gemini-3.1-flash-image-preview");

      const location = resolvedTier === "pro"
        ? (s(process.env.VERTEX_IMAGE_LOCATION_PRO || process.env.VERTEX_IMAGE_LOCATION) || "global").trim()
        : (s(process.env.VERTEX_IMAGE_LOCATION_FLASH || process.env.VERTEX_IMAGE_LOCATION) || "global").trim();
      const base = baseUrlFor(location);
      const url = `${base}/v1beta1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

      const imageConfig:any = { aspectRatio };
      if(numberOfImages > 1) imageConfig.numberOfImages = numberOfImages;
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
        extra: legacyImagenRemap ? { remappedFromLegacyImagen: true as const } : undefined,
      });
      return res.status(r.ok ? 200 : 502).json(bodyNb);
    }

    if(op === "upscaleImage"){
      const imageUrl = s(b.imageUrl || q.imageUrl || "");
      if(!imageUrl) return res.status(400).json({ok:false,error:"missing_image_url"});
      const prompt = s(b.prompt || q.prompt || "");
      const outputMimeType = s(b.outputMimeType || q.outputMimeType || "image/png").trim() || "image/png";
      const requestedFactor = s(b.upscaleFactor || q.upscaleFactor || "x2").toLowerCase();
      const upscaleFactor = (requestedFactor === "x4" ? "x4" : requestedFactor === "x3" ? "x3" : "x2") as "x2"|"x3"|"x4";
      const result = await runVertexUpscaleImage({ imageUrl, prompt, upscaleFactor, outputMimeType });
      return res.status(result.ok ? 200 : 502).json(result);
    }

    // ---------------- Veo (video) ----------------
    if(op === "veoCreate"){
      if(req.method !== "POST") return res.status(405).json({ok:false,error:"Method not allowed"});
      const provider = s(b.provider || q.provider || "pro").toLowerCase(); // rapid|pro
      const prompt = s(b.prompt || q.prompt || "");
      const imageUrl = s(b.imageUrl || q.imageUrl || "");
      if(!prompt) return res.status(400).json({ok:false,error:"missing_prompt"});
      if(!imageUrl) return res.status(400).json({ok:false,error:"missing_image_url"});

      const mode = (provider.includes("rapid") || provider.includes("fast")) ? "rapid" : "pro";
      const model = mode === "rapid"
        ? s(process.env.VERTEX_VEO_MODEL_RAPID || "veo-3.1-fast-generate-001")
        : s(process.env.VERTEX_VEO_MODEL_PRO || "veo-3.1-generate-001");

      const location = mode === "rapid"
        ? s(process.env.VERTEX_VIDEO_LOCATION_RAPID || "us-central1")
        : s(process.env.VERTEX_VIDEO_LOCATION_PRO || "us-central1");

      const base = baseUrlFor(location);

      const img = await fetchImageAsBase64(imageUrl);

      const durationSeconds = Number(b.durationSeconds || b.duration || 8) || 8;
      const aspectRatio = s(b.aspectRatio || "16:9");
      const resolution = s(b.resolution || "720p");

      const url = `${base}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predictLongRunning`;

      const r = await fetchJson(url,{
        method:"POST",
        headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" },
        body: JSON.stringify({
          instances:[{ prompt, image:{ bytesBase64Encoded: img.b64, mimeType: img.mimeType } }],
          parameters:{ aspectRatio, resolution, durationSeconds, generateAudio:true, upscale:false }
        })
      });

      const taskId = r.json?.name ? String(r.json.name) : "";
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, taskId: taskId || null, raw:r.json ?? r.rawText });
    }

    if(op === "veoTask"){
      const provider = s(q.provider || b.provider || "pro").toLowerCase();
      const taskId = s(q.taskId || b.taskId || "");
      if(!taskId) return res.status(400).json({ok:false,error:"missing_taskId"});

      const mode = (provider.includes("rapid") || provider.includes("fast")) ? "rapid" : "pro";
      const model = mode === "rapid"
        ? s(process.env.VERTEX_VEO_MODEL_RAPID || "veo-3.1-fast-generate-001")
        : s(process.env.VERTEX_VEO_MODEL_PRO || "veo-3.1-generate-001");

      const location = mode === "rapid"
        ? s(process.env.VERTEX_VIDEO_LOCATION_RAPID || "us-central1")
        : s(process.env.VERTEX_VIDEO_LOCATION_PRO || "us-central1");

      const base = baseUrlFor(location);
      const operationName = normalizePredictOperationName(taskId, projectId, location, model);

      const url = `${base}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:fetchPredictOperation`;

      const r = await fetchJson(url,{
        method:"POST",
        headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" },
        body: JSON.stringify({ operationName })
      });

      if(!r.ok) return res.status(502).json({ ok:false, status:r.status, raw:r.json ?? r.rawText });

      let videoUrl = extractVideoUrl(r.json);
      const done = Boolean(r.json?.done);
      const failed = done && !!r.json?.error;
      const status = failed ? "failed" : done ? "succeeded" : "running";

      let materialized = false;
      if (done && !failed && !videoUrl) {
        const uploaded = await materializeGeneratedVideo(taskId, r.json).catch(() => ({ videoUrl: "", materialized: false }));
        videoUrl = uploaded.videoUrl || "";
        materialized = Boolean(uploaded.materialized);
      }

      return res.status(200).json({ ok:true, status, videoUrl: videoUrl || null, materialized, raw:r.json });
    }

    // ---------------- translateForVeo (中文音效/台词 → Veo 原生英文指令) ----------------
    if (op === "translateForVeo") {
      const rawPrompt = s(b.prompt || q.prompt || "").trim();
      if (!rawPrompt) return res.status(400).json({ ok: false, error: "missing_prompt" });

      const geminiApiKey = s(process.env.GEMINI_API_KEY).trim();
      if (!geminiApiKey) return res.status(500).json({ ok: false, error: "missing_env", detail: "GEMINI_API_KEY" });

      const translateBody = {
        contents: [{
          parts: [{
            text: `You are a professional AI video prompt translator. Convert the following Chinese video scene audio description into a Veo-native English audio prompt.

Rules:
1. Translate ALL sound effect descriptions and action descriptions into precise English.
2. Extract character dialogue and keep it in the original Chinese, using the format: A [male/female/old/young] voice speaking Mandarin Chinese: "[original Chinese dialogue]"
3. If multiple characters speak, list each one separately.
4. Output ONLY the final English audio prompt. No explanations, no preamble.

Chinese input:
${rawPrompt}

English Veo audio prompt:`
          }]
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 512 }
      };

      const model = "gemini-3-flash-preview";
      const tRes = await fetchJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(translateBody) }
      );

      if (!tRes.ok) {
        console.error("[translateForVeo] Gemini Flash failed:", tRes.status, tRes.rawText?.slice(0, 200));
        // 降级：原样返回，让 Veo 尽力处理
        return res.status(200).json({ ok: true, translated: rawPrompt, fallback: true });
      }

      const translatedText = (tRes.json?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      if (!translatedText) return res.status(200).json({ ok: true, translated: rawPrompt, fallback: true });

      console.log(`[translateForVeo] ✅ 翻译成功: ${translatedText.slice(0, 120)}...`);
      return res.status(200).json({ ok: true, translated: translatedText, fallback: false });
    }

    return res.status(400).json({ok:false,error:"unknown_op",op});
  }catch(e:any){
    return res.status(500).json({ok:false,error:"server_error",message:e?.message||String(e)});
  }
}
