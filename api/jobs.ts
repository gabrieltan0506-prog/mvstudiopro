import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { setShortLink } from "./_core/shortlink-store.js";

function asString(v: any): string {
  if (v == null) return "";
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

function safeJsonParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

function getReqBody(req: VercelRequest): any {
  const b: any = (req as any).body;
  if (!b) return {};
  if (typeof b === "string") return safeJsonParse(b) ?? {};
  return b;
}

function pickFirst(...vals: any[]): string {
  for (const val of vals) {
    const s = asString(val).trim();
    if (s) return s;
  }
  return "";
}

function isVideoProvider(provider: string): boolean {
  const p = provider.trim().toLowerCase();
  if (!p) return false;
  return p.includes("veo") || p === "video";
}


function normalizeOperationName(taskId: string): string {
  const id = taskId.trim();
  if (!id) return "";
  if (id.startsWith("operations/")) return id;
  return `operations/${id}`;
}

function toTaskId(operationName: string): string {
  const op = operationName.trim();
  if (!op) return "";
  return op.replace(/^operations\//, "");
}

function extractVideoUrl(raw: any): string {
  const candidates = [
    raw?.response?.generatedVideos?.[0]?.video?.uri,
    raw?.response?.generatedVideos?.[0]?.video?.url,
    raw?.response?.generatedSamples?.[0]?.video?.uri,
    raw?.response?.generatedSamples?.[0]?.video?.url,
    raw?.generatedVideos?.[0]?.video?.uri,
    raw?.generatedVideos?.[0]?.video?.url,
    raw?.raw?.data?.[0]?.task_result?.videos?.[0]?.url,
    raw?.raw?.data?.task_result?.videos?.[0]?.url,
  ];
  for (const v of candidates) {
    const s = asString(v).trim();
    if (s) return s;
  }
  return "";
}

async function getVertexAccessToken(): Promise<string> {
  const raw = asString(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON).trim();
  if (!raw) throw new Error("Missing env: GOOGLE_APPLICATION_CREDENTIALS_JSON");

  const sa = safeJsonParse(raw);
  if (!sa?.client_email || !sa?.private_key) throw new Error("Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON");

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
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
      assertion
    }).toString()
  });

  const json: any = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !json?.access_token) {
    throw new Error("Vertex token failed: " + JSON.stringify(json));
  }
  return json.access_token as string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const q: any = req.query || {};
    const b: any = req.method === "POST" ? getReqBody(req) : {};

    const hasImage = Boolean(
      b.image || (b.input && b.input.image) || b.imageDataUrl || (b.input && b.input.imageDataUrl) ||
      q.image || q.imageDataUrl
    );

    const typeRaw = asString(b.type || q.type);
    const taskIdRaw = asString(b.taskId || q.taskId);
    const providerRaw = asString(b.provider || (b.input && b.input.provider) || q.provider);
    const prompt = asString(b.prompt || (b.input && b.input.prompt) || q.prompt);
    const debug = asString(b.debug || q.debug) === "1";
    const inferredType = taskIdRaw ? "video" : (isVideoProvider(providerRaw) && (hasImage || prompt) ? "video" : (prompt ? "image" : ""));
    const type = typeRaw || inferredType;
    const provider = providerRaw || (type === "video" ? "veo_3_1" : "nano-banana-flash");
    const taskId = toTaskId(taskIdRaw);

    if (!type && !prompt && !taskId) {
      return res.status(200).json({ ok: true, message: "jobs endpoint reachable" });
    }
    if (type === "image") {
      if (!prompt) {
        return res.status(400).json({ ok: false, error: "missing_prompt" });
      }

      const imageSizeRaw = pickFirst(b.imageSize, b.image_size, q.imageSize, q.image_size).toUpperCase();
      const imageSize = (imageSizeRaw === "2K" || imageSizeRaw === "4K" ? imageSizeRaw : "1K");
      const model = "gemini-3-pro-image-preview";

      if (!model) {
        return res.status(500).json({ ok: false, error: "missing_env", detail: "Missing VERTEX_IMAGE_MODEL_FLASH/PRO" });
      }

      const projectId = asString(process.env.VERTEX_PROJECT_ID);
      if (!projectId) {
        return res.status(500).json({ ok: false, error: "missing_env", detail: "Missing VERTEX_PROJECT_ID" });
      }

      const location = asString(process.env.VERTEX_IMAGE_LOCATION || "global");
      const baseUrl =
        location === "global"
          ? "https://aiplatform.googleapis.com"
          : `https://${location}-aiplatform.googleapis.com`;

      const url = `${baseUrl}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
      const token = await getVertexAccessToken();

      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { imageSize } }
        })
      });

      const json: any = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return res.status(500).json({
          ok: false,
          type: "image",
          provider,
          error: "image_generation_failed",
          detail: { status: upstream.status, raw: json, location, model }
        });
      }

      const parts: any[] = json?.candidates?.[0]?.content?.parts || [];
      let base64img: string | null = null;
      for (const p of parts) {
        if (p?.inlineData?.data) {
          base64img = String(p.inlineData.data);
          break;
        }
      }

      if (!base64img) {
        return res.status(500).json({
          ok: false,
          type: "image",
          provider,
          error: "no_image_in_response",
          detail: { location, model, raw: json }
        });
      }

      const out: any = {
        ok: true,
        type: "image",
        provider,
        imageUrl: `data:image/png;base64,${base64img}`
      };
      if (debug) out.debug = { location, model };
      

      return res.status(200).json(out);
    }
    if (type === "video") {
      // Veo 3.1: image-to-video only (no text-only)
      // Accept both GET (status) and POST (create)

      const projectId = asString(process.env.VERTEX_PROJECT_ID).trim();
const location = asString(process.env.VERTEX_VIDEO_LOCATION || "us-central1");
      const baseUrl =
        location === "global"
          ? "https://aiplatform.googleapis.com"
          : `https://${location}-aiplatform.googleapis.com`;

      const proModel = asString(process.env.VERTEX_VEO_MODEL_PRO).trim();
      const rapidModel = asString(process.env.VERTEX_VEO_MODEL_RAPID).trim();
      if (!proModel && !rapidModel) {
        return res.status(500).json({
          ok: false,
          type: "video",
          provider,
          error: "missing_env",
          detail: "Missing VERTEX_VEO_MODEL_PRO / VERTEX_VEO_MODEL_RAPID"
        });
      }

      // status polling: GET/POST with taskId
      if (taskId) {
        const operationName = normalizeOperationName(taskId);
        const statusUrl = `${baseUrl}/v1/${operationName}`;
        const token = await getVertexAccessToken();

        const upstream = await fetch(statusUrl, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` }
        });

        const json: any = await upstream.json().catch(() => ({}));
        if (!upstream.ok) {
          return res.status(500).json({
            ok: false,
            type: "video",
            provider,
            taskId,
            error: "video_status_failed",
            detail: { status: upstream.status, raw: json, location }
          });
        }

        const done = Boolean(json?.done);
        const failed = done && !!json?.error;
        const videoUrl = extractVideoUrl(json);
        const status = failed ? "failed" : done ? "succeeded" : "running";

        if (videoUrl) {
          await setShortLink(taskId, videoUrl);
        }

        return res.status(200).json({
          ok: true,
          type: "video",
          provider,
          taskId,
          status,
          videoUrl: videoUrl || undefined,
          shortUrl: videoUrl ? `/api/v/${encodeURIComponent(taskId)}` : undefined,
          error: failed ? json?.error : undefined,
          raw: json,
          debug: debug ? { location, proModel, rapidModel } : undefined
        });
      }

      // create: image-to-video only
      const imgVal = pickFirst(
        b.image,
        b?.input?.image,
        b.imageDataUrl,
        b?.input?.imageDataUrl,
        q.image,
        q.imageDataUrl
      );

      if (!imgVal) {
        return res.status(400).json({
          ok: false,
          type: "video",
          provider,
          error: "missing_image",
          detail: "Please upload a reference image (image-to-video only)"
        });
      }

      // Accept data URL or raw base64
      const imgStr = asString(imgVal).trim();
      let mimeType = "image/png";
      let imageB64 = imgStr;

      const m = imgStr.match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        mimeType = m[1] || mimeType;
        imageB64 = m[2] || "";
      }

      if (!imageB64) {
        return res.status(400).json({ ok: false, type: "video", provider, error: "invalid_image" });
      }

      // model select: pro vs rapid (no "standard" wording)
      const pLower = provider.toLowerCase();
      const isFastModel = pLower === "veo-3.1-fast-generate-001";
      const model = isFastModel
        ? (rapidModel || "veo-3.1-fast-generate-001")
        : (proModel || "veo-3.1-generate-001");

      const aspectRatio = pickFirst(b.aspect_ratio, b.aspectRatio, q.aspect_ratio, q.aspectRatio) || "16:9";
      const resolution = pickFirst(b.resolution, q.resolution) || "720p";
      const negativePrompt = pickFirst(b.negativePrompt, b.negative_prompt, q.negativePrompt, q.negative_prompt);
      const promptVideo = asString(prompt).trim(); // can be empty, used as steering

      const createUrl = `${baseUrl}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:generateVideos`;

      const token = await getVertexAccessToken();

      const createBody: any = {
        prompt: promptVideo,
        image: {
          imageBytes: imageB64,
          mimeType,
        },
        config: {
          numberOfVideos: 1,
          aspectRatio,
          resolution,
          durationSeconds: 8,
          generateAudio: false,
        },
      };
      if (negativePrompt) createBody.config.negativePrompt = negativePrompt;

      const upstream = await fetch(createUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(createBody)
      });

      const json: any = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return res.status(500).json({
          ok: false,
          type: "video",
          provider,
          error: "video_create_failed",
          detail: { status: upstream.status, raw: json, location, model }
        });
      }

      const operationName = asString(json?.name).trim();
      if (!operationName) {
        return res.status(500).json({
          ok: false,
          type: "video",
          provider,
          error: "missing_task_id",
          detail: { raw: json, location, model }
        });
      }

      const createdTaskId = toTaskId(operationName);

      const out: any = {
        ok: true,
        type: "video",
        provider,
        taskId: createdTaskId,
        status: "running",
        raw: json
      };
      if (debug) out.debug = { location, model, proModel, rapidModel };

      

      // ====== VIDEO UPSCALE ======
      if (b.upscale === true && json?.response?.generatedVideos?.[0]?.video?.uri) {
        const originalUrl = json.response.generatedVideos[0].video.uri;
        const upscaleUrl = `${baseUrl}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:upscaleVideo`;

        const upRes = await fetch(upscaleUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            video: { uri: originalUrl },
            config: { targetResolution: "1080p" }
          })
        });

        const upJson = await upRes.json().catch(() => ({}));

        if (upRes.ok && upJson?.response?.video?.uri) {
          return res.status(200).json({
            ok: true,
            type: "video",
            provider,
            videoUrl: upJson.response.video.uri,
            upscale: true
          });
        }
      }
      // ====== END UPSCALE ======

      return res.status(200).json(out);
    }

    return res.status(400).json({ ok: false, error: "unsupported_type", type });
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: e?.message || String(e)
    });
  }
}
