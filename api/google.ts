import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { put } from "@vercel/blob";
import { generateImagenVertexPredict } from "../server/services/imageGenerationService";
import { runVertexUpscaleImage, type VertexUpscaleResult } from "../server/services/vertexImage";
export { runVertexUpscaleImage, type VertexUpscaleResult };

/**
 * Google Gateway (single function)
 * - op=geminiScript    (Gemini text)
 * - **Imagen 4.0 Ultra（Consumer / `generativelanguage…:predict` + GEMINI_API_KEY）實測：目前僅 `imagen-4.0-ultra-generate-001` 穩定成功**；其餘 Ultra 字串多數失敗，見 Test Lab smoke。
 * - op=nanoImage       （Gemini / Nano Banana：`generateContent`；Imagen 4.x Consumer：`predict` + API Key；**可選 `imagenBackend=vertex` 走 Vertex 企業節點 `…:predict` + SA，預設 region `us-central1`，無模型降級**）
 * - op=veoCreate       (Veo create)
 * - op=veoTask         (Veo polling)
 * - op=translateForVeo (Chinese → Veo-native English audio prompt)
 *
 * Env:
 * - GOOGLE_APPLICATION_CREDENTIALS_JSON
 * - GEMINI_API_KEY（transcribeAudio、凡 model 以 imagen-4.0 开头的生图走 `…:predict`、translateForVeo）
 * - GEMINI_IMAGEN_ULTRA_MODEL（可选：当请求 model 与该变量完全一致时也走 API Key 生图，用于不以 imagen-4.0 前缀命名的别名 ID）
 * - VERTEX_PROJECT_ID（除上述免 Vertex 的 op 外必填；Vertex Imagen 亦用，可另備 GOOGLE_CLOUD_PROJECT）
 * - VERTEX_IMAGEN_LOCATION（可选，默认 us-central1）
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

async function getVertexAccessToken(): Promise<string> {
  const raw = s(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON).trim();
  if (!raw) throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS_JSON");

  const sa:any = jparse(raw);
  if (!sa?.client_email || !sa?.private_key) throw new Error("Invalid SA JSON");

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).toString("base64url");

  const unsigned = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(unsigned);
  sign.end();
  const signature = sign.sign(sa.private_key).toString("base64url");
  const assertion = `${unsigned}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  const json:any = await tokenRes.json().catch(()=> ({}));
  if (!tokenRes.ok || !json?.access_token) throw new Error("Vertex token failed: " + JSON.stringify(json));
  return json.access_token;
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

/** Test Lab / 网关传入的 personGeneration 枚举 → Gemini Imagen `predict` parameters 小写值 */
function mapPersonGenerationForGeminiImagenPredict(raw: string): string | undefined {
  const u = s(raw).trim().toUpperCase().replace(/-/g, "_");
  if (!u) return undefined;
  if (u === "ALLOW_ADULT") return "allow_adult";
  if (u === "ALLOW_ALL") return "allow_all";
  if (u === "DONT_ALLOW") return "dont_allow";
  return undefined;
}

/** 所有以 imagen-4.0 开头的 model 均走 generativelanguage + GEMINI_API_KEY + `:predict`（不经 Vertex nanoImage）。 */
function isImagen4GeminiApiModel(rawModel: string): boolean {
  const m = s(rawModel).trim();
  if (!m) return false;
  const alias = s(process.env.GEMINI_IMAGEN_ULTRA_MODEL || "").trim();
  if (alias.length > 0 && m === alias) return true;
  return m.toLowerCase().startsWith("imagen-4.0");
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

    // ---------------- nanoImage：Vertex Imagen（企業 `:predict`，無降級） / Consumer Imagen 4（GEMINI_API_KEY + `…:predict`，與 AI Studio REST 一致） / 下文 Nano Banana（Vertex generateContent） ----------------
    if (op === "nanoImage") {
      const imagenBackend = s(q.imagenBackend || b.imagenBackend).toLowerCase();
      const promptUltra = s(b.prompt || q.prompt || "");
      const rawUltra = s(b.model || q.model || "");

      if (imagenBackend === "vertex" && promptUltra) {
        if (!isImagen4GeminiApiModel(rawUltra)) {
          return res.status(400).json({
            ok: false,
            error: "vertex_imagen_requires_imagen_4_model",
            detail: "imagenBackend=vertex 仅支持 imagen-4.0* 模型 ID（与 Consumer Ultra 命名对齐）。",
            model: rawUltra,
          });
        }
        const aspectRatioVx = s(b.aspectRatio || q.aspectRatio || "1:1");
        const sizeVx = s(b.imageSize || q.imageSize || "1K").toUpperCase();
        const numberOfImagesVx = Math.max(1, Math.min(4, Number(b.numberOfImages || q.numberOfImages || 1) || 1));
        const seedVx = q.seed != null || b.seed != null ? Number(b.seed || q.seed) : undefined;
        const personGenerationVx = mapPersonGenerationForGeminiImagenPredict(s(b.personGeneration || q.personGeneration || ""));
        const guidanceScaleVx = Number(b.guidanceScale || q.guidanceScale || NaN);

        const rVx = await generateImagenVertexPredict({
          prompt: promptUltra,
          model: s(rawUltra).trim(),
          aspectRatio: aspectRatioVx,
          imageSize: sizeVx,
          numberOfImages: numberOfImagesVx,
          seed: Number.isFinite(seedVx as number) ? (seedVx as number) : undefined,
          personGeneration: personGenerationVx,
          guidanceScale: Number.isFinite(guidanceScaleVx) ? guidanceScaleVx : undefined,
        });

        return res.status(rVx.ok ? 200 : 502).json({
          ok: rVx.ok,
          status: rVx.status,
          model: rVx.model,
          url: rVx.url,
          raw: rVx.raw,
          imageUrl: rVx.imageUrl,
          imageUrls: rVx.imageUrls,
          imageCount: rVx.imageCount,
          imagenBackend: "vertex",
          vertexLocation: rVx.location,
          ...(rVx.error ? { error: rVx.error } : {}),
        });
      }

      if (promptUltra && isImagen4GeminiApiModel(rawUltra)) {
        const geminiApiKey = s(process.env.GEMINI_API_KEY).trim();
        if (!geminiApiKey) {
          return res.status(500).json({ ok: false, error: "missing_env", detail: "GEMINI_API_KEY" });
        }
        const geminiImagenModel = s(rawUltra).trim();
        if (!geminiImagenModel) {
          return res.status(400).json({ ok: false, error: "missing_model_for_imagen_4" });
        }
        const aspectRatioU = s(b.aspectRatio || q.aspectRatio || "1:1");
        const sizeU = s(b.imageSize || q.imageSize || "1K").toUpperCase();
        const numberOfImagesU = Math.max(1, Math.min(4, Number(b.numberOfImages || q.numberOfImages || 1) || 1));
        const seedU = q.seed != null || b.seed != null ? Number(b.seed || q.seed) : undefined;
        const personGenerationU = mapPersonGenerationForGeminiImagenPredict(s(b.personGeneration || q.personGeneration || ""));

        const parameters: Record<string, unknown> = {
          sampleCount: numberOfImagesU,
          aspectRatio: aspectRatioU,
        };
        if (sizeU === "1K" || sizeU === "2K" || sizeU === "4K") parameters.imageSize = sizeU;
        if (Number.isFinite(seedU as number)) parameters.seed = Math.floor(seedU as number);
        if (personGenerationU) parameters.personGeneration = personGenerationU;

        const glUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiImagenModel}:predict?key=${geminiApiKey}`;
        const requestInitUltra: RequestInit = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instances: [{ prompt: promptUltra }],
            parameters,
          }),
          signal: AbortSignal.timeout(120_000),
        };
        let rU = await fetchJson(glUrl, requestInitUltra);
        for (let attempt = 0; attempt < 4 && shouldRetryVertexImage(rU.status, rU.json, rU.rawText); attempt += 1) {
          await sleep((2 ** attempt) * 1000 + Math.floor(Math.random() * 300));
          rU = await fetchJson(glUrl, requestInitUltra);
        }
        const rawU = rU.json ?? rU.rawText;
        const imagesU = rU.ok ? extractGeneratedImages(rU.json) : [];
        const imageUrlsU = imagesU.map((item) => `data:${item.mimeType};base64,${item.data}`);
        return res.status(rU.ok ? 200 : 502).json({
          ok: rU.ok,
          status: rU.status,
          model: geminiImagenModel,
          url: glUrl.split("?")[0],
          raw: rawU,
          imageUrl: imageUrlsU[0] || "",
          imageUrls: imageUrlsU,
          imageCount: imageUrlsU.length,
        });
      }
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
    // op=nanoImage, tier=flash|pro, size=1K|2K|4K, aspectRatio=16:9...
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

      const rawModel = s(b.model || q.model || "");
      if (isImagen4GeminiApiModel(rawModel)) {
        return res.status(400).json({
          ok: false,
          error: "imagen_4_vertex_conflict",
          detail: "凡 imagen-4.0* 生图仅走 generativelanguage `…:predict` + GEMINI_API_KEY；请检查前置分支是否生效或是否缺少 prompt。",
        });
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
      if(resolvedTier === "pro") imageConfig.imageSize = size;

      const requestInit: RequestInit = {
        method:"POST",
        headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" },
        body: JSON.stringify({
          contents:[{role:"user",parts:[{text:prompt}]}],
          generationConfig:{ responseModalities:["IMAGE"], imageConfig }
        })
      };
      let r = await fetchJson(url, requestInit);
      for (let attempt = 0; attempt < 4 && shouldRetryVertexImage(r.status, r.json, r.rawText); attempt += 1) {
        await sleep((2 ** attempt) * 1000 + Math.floor(Math.random() * 300));
        r = await fetchJson(url, requestInit);
      }

      const raw = r.json ?? r.rawText;
      const images = r.ok ? extractGeneratedImages(r.json) : [];
      const imageUrls = images.map((item) => `data:${item.mimeType};base64,${item.data}`);
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, url:r.url, raw, imageUrl: imageUrls[0] || "", imageUrls, imageCount: imageUrls.length });
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
