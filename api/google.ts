import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";

/**
 * Google Gateway (single function)
 * - op=geminiScript (Gemini text)
 * - op=nanoImage    (Nano Banana image)
 * - op=veoCreate    (Veo create)
 * - op=veoTask      (Veo polling)
 *
 * Env:
 * - GOOGLE_APPLICATION_CREDENTIALS_JSON
 * - VERTEX_PROJECT_ID
 * - VERTEX_IMAGE_MODEL_FLASH / VERTEX_IMAGE_MODEL_PRO
 * - VERTEX_IMAGE_LOCATION (optional, default global)
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

async function fetchImageAsBase64(imageUrl:string){
  const url = s(imageUrl).trim();
  if(!url) throw new Error("missing_image_url");

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
  if(buf.length > 8*1024*1024) throw new Error("image_too_large");
  return { mimeType, b64: buf.toString("base64"), bytes: buf.length };
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  try{
    const q:any = req.query || {};
    const b:any = req.method==="POST" ? getBody(req) : {};
    const op = s(q.op || b.op).trim();
    if(!op) return res.status(400).json({ok:false,error:"missing_op"});

    const projectId = s(process.env.VERTEX_PROJECT_ID).trim();
    if(!projectId) return res.status(500).json({ok:false,error:"missing_env",detail:"VERTEX_PROJECT_ID"});

    const token = await getVertexAccessToken();

    // ---------------- Gemini (text) ----------------
    if(op === "geminiScript"){
      const prompt = s(b.prompt || q.prompt || "");
      if(!prompt) return res.status(400).json({ok:false,error:"missing_prompt"});

      const location = (s(process.env.VERTEX_GEMINI_LOCATION) || "global").trim();
      const model = (s(process.env.VERTEX_GEMINI_MODEL) || "gemini-2.5-pro").trim();
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

      const requestedModel = s(b.model || q.model || "");
      const resolvedTier = requestedModel
        ? (requestedModel === "imagen-4.0-ultra-generate-001" ? "pro" : "flash")
        : tier;

      const model = requestedModel
        ? requestedModel
        : resolvedTier === "pro"
          ? s(process.env.VERTEX_IMAGE_MODEL_PRO || "imagen-4.0-ultra-generate-001")
          : s(process.env.VERTEX_IMAGE_MODEL_FLASH || "imagen-4.0-generate-001");

      const location = resolvedTier === "pro"
        ? (s(process.env.VERTEX_IMAGE_LOCATION_PRO || process.env.VERTEX_IMAGE_LOCATION) || "us-central1").trim()
        : (s(process.env.VERTEX_IMAGE_LOCATION_FLASH || process.env.VERTEX_IMAGE_LOCATION) || "us-central1").trim();
      const base = baseUrlFor(location);
      const url = `${base}/v1beta1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

      const imageConfig:any = { aspectRatio };
      if(negativePrompt) imageConfig.negativePrompt = negativePrompt;
      if(numberOfImages > 1) imageConfig.numberOfImages = numberOfImages;
      if(Number.isFinite(guidanceScale) && guidanceScale > 0) imageConfig.guidanceScale = guidanceScale;
      if(Number.isFinite(seed as number)) imageConfig.seed = Math.floor(seed as number);
      if(personGeneration) imageConfig.personGeneration = personGeneration;
      if(resolvedTier === "pro") imageConfig.imageSize = size;

      const r = await fetchJson(url,{
        method:"POST",
        headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" },
        body: JSON.stringify({
          contents:[{role:"user",parts:[{text:prompt}]}],
          generationConfig:{ responseModalities:["IMAGE"], imageConfig }
        })
      });

      const raw = r.json ?? r.rawText;
      const images = r.ok ? extractGeneratedImages(r.json) : [];
      const imageUrls = images.map((item) => `data:${item.mimeType};base64,${item.data}`);
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, url:r.url, raw, imageUrl: imageUrls[0] || "", imageUrls, imageCount: imageUrls.length });
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
          parameters:{ aspectRatio, resolution, durationSeconds, generateAudio:false, upscale:false }
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

      const videoUrl = extractVideoUrl(r.json);
      const done = Boolean(r.json?.done);
      const failed = done && !!r.json?.error;
      const status = failed ? "failed" : done ? "succeeded" : "running";

      return res.status(200).json({ ok:true, status, videoUrl: videoUrl || null, raw:r.json });
    }

    return res.status(400).json({ok:false,error:"unknown_op",op});
  }catch(e:any){
    return res.status(500).json({ok:false,error:"server_error",message:e?.message||String(e)});
  }
}
