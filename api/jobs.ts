import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";

function asString(v: any): string {
  if (v == null) return "";
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

function safeJsonParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function getBody(req: VercelRequest): any {
  const b: any = req.body;
  if (!b) return {};
  if (typeof b === "string") return safeJsonParse(b) ?? {};
  return b;
}

function normalizeVideoProvider(provider: string): "rapid" | "pro" {
  const p = provider.trim().toLowerCase();
  if (p.includes("fast") || p.includes("rapid")) return "rapid";
  return "pro";
}

function extractVideoUrl(raw: any): string {
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
    const v = asString(item).trim();
    if (v) return v;
  }
  return "";
}

function readPngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  const pngSig = "89504e470d0a1a0a";
  if (buf.subarray(0, 8).toString("hex") !== pngSig) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

function readJpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) break;
    const isSof =
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf;
    if (isSof) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      if (!width || !height) return null;
      return { width, height };
    }
    i += 2 + len;
  }
  return null;
}

function getImageSizeFromBase64(base64Data: string): { width: number; height: number } | null {
  try {
    const buf = Buffer.from(base64Data, "base64");
    return readPngSize(buf) || readJpegSize(buf);
  } catch {
    return null;
  }
}

async function parseUpstream(resp: Response): Promise<{ raw: any; rawText: string; bodyEmpty: boolean }> {
  const text = await resp.text();
  const rawText = text.slice(0, 4000);
  const raw = safeJsonParse(text);
  return { raw, rawText, bodyEmpty: text.length === 0 };
}

async function getVertexAccessToken(): Promise<string> {
  const raw = asString(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON).trim();
  if (!raw) throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS_JSON");

  const sa = safeJsonParse(raw);
  if (!sa?.client_email || !sa?.private_key) throw new Error("Invalid SA JSON");

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");

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

  const json: any = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !json?.access_token) throw new Error(`Vertex token failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function thirdPartyRapidFallback(input: {
  prompt: string;
  imageUrl: string;
  aspectRatio: string;
  resolution: string;
}): Promise<{ ok: boolean; data?: any; error?: any }> {
  const endpoint = asString(process.env.THIRDPARTY_VIDEO_FALLBACK_URL).trim();
  if (!endpoint) return { ok: false, error: "fallback_not_configured" };

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const { raw, rawText } = await parseUpstream(r);
    if (!r.ok) return { ok: false, error: { status: r.status, raw, rawText } };
    return { ok: true, data: raw ?? { rawText } };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST" && req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const q: any = req.query || {};
    const b: any = req.method === "POST" ? getBody(req) : {};

    const type = asString(b.type || q.type);
    const provider = asString(b.provider || q.provider || "");
    const taskId = asString(b.taskId || q.taskId || "");
    const prompt = asString(b.prompt || q.prompt || "");

    const projectId = asString(process.env.VERTEX_PROJECT_ID).trim();
    if (!projectId) {
      return res.status(500).json({ ok: false, error: "missing_env", detail: "Missing VERTEX_PROJECT_ID" });
    }

    const token = await getVertexAccessToken();

    if (type === "image") {
      if (!prompt) return res.status(400).json({ ok: false, error: "missing_prompt" });

      const imageProvider = provider || "nano-banana-flash";
      const requestedSize = asString(b.imageSize || q.imageSize || "1K").toUpperCase();
      const requestedAspectRatio = asString(b.aspectRatio || q.aspectRatio || "16:9");

      const allowedSizes = new Set(["1K", "2K", "4K"]);
      const allowedRatios = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);
      const isPro = imageProvider === "nano-banana-pro";

      if (!allowedSizes.has(requestedSize)) {
        return res.status(400).json({ ok: false, error: "invalid_image_size", detail: requestedSize });
      }
      if (!allowedRatios.has(requestedAspectRatio)) {
        return res.status(400).json({ ok: false, error: "invalid_aspect_ratio", detail: requestedAspectRatio });
      }

      // Paid policy: free only 1K + 16:9
      if (!isPro && (requestedSize !== "1K" || requestedAspectRatio !== "16:9")) {
        return res.status(403).json({
          ok: false,
          error: "paid_required",
          detail: "2K/4K and custom aspect ratio are available for Pro only",
        });
      }

      const model = isPro
        ? asString(process.env.VERTEX_IMAGE_MODEL_PRO || "gemini-3-pro-image-preview")
        : asString(process.env.VERTEX_IMAGE_MODEL_FLASH || "gemini-2.5-flash-image");

      // Pro image should run on global by default; flash can be configured independently.
      const location = isPro
        ? asString(process.env.VERTEX_IMAGE_LOCATION_PRO || "global")
        : asString(process.env.VERTEX_IMAGE_LOCATION_FLASH || process.env.VERTEX_IMAGE_LOCATION || "global");
      const baseUrl = location === "global" ? "https://aiplatform.googleapis.com" : `https://${location}-aiplatform.googleapis.com`;
      // Use v1beta1 for image generation controls (imageConfig.imageSize/aspectRatio)
      // to avoid silent downgrades to default 1K on incompatible endpoint versions.
      const url = `${baseUrl}/v1beta1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

      const imageConfig: Record<string, any> = {
        aspectRatio: isPro ? requestedAspectRatio : "16:9",
      };
      if (isPro) {
        // Important: imageSize must be in generationConfig.imageConfig
        imageConfig.imageSize = requestedSize;
      }

      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig,
          },
        }),
      });

      const { raw, rawText, bodyEmpty } = await parseUpstream(upstream);
      if (!upstream.ok) {
        return res.status(500).json({
          ok: false,
          error: "image_generation_failed",
          detail: {
            status: upstream.status,
            model,
            location,
            endpoint: url,
            bodyEmpty,
            raw: raw ?? undefined,
            rawText,
          },
        });
      }

      const parts = raw?.candidates?.[0]?.content?.parts || [];
      let base64img: string | null = null;
      for (const p of parts) {
        if (p?.inlineData?.data) {
          base64img = p.inlineData.data;
          break;
        }
      }

      if (!base64img) {
        return res.status(500).json({
          ok: false,
          error: "no_image_in_response",
          detail: { model, location, raw: raw ?? undefined, rawText },
        });
      }

      const actual = getImageSizeFromBase64(base64img);
      const maxEdge = actual ? Math.max(actual.width, actual.height) : 0;
      const sizeMismatch =
        isPro &&
        ((requestedSize === "2K" && maxEdge > 0 && maxEdge < 1900) ||
          (requestedSize === "4K" && maxEdge > 0 && maxEdge < 3800));

      if (sizeMismatch) {
        return res.status(500).json({
          ok: false,
          error: "image_size_not_honored",
          detail: {
            requestedSize,
            actualSize: actual,
            model,
            location,
            requestImageConfig: imageConfig,
          },
        });
      }

      return res.status(200).json({
        ok: true,
        provider: imageProvider,
        model,
        location,
        imageSize: isPro ? requestedSize : "1K",
        aspectRatio: isPro ? requestedAspectRatio : "16:9",
        requestImageConfig: imageConfig,
        actualSize: actual,
        imageUrl: `data:image/png;base64,${base64img}`,
      });
    }

    if (type === "video") {
      const mode = normalizeVideoProvider(provider);
      const model =
        mode === "rapid"
          ? asString(process.env.VERTEX_VEO_MODEL_RAPID || "veo-3.1-fast-generate-001")
          : asString(process.env.VERTEX_VEO_MODEL_PRO || "veo-3.1-generate-001");

      const location =
        mode === "rapid"
          ? asString(process.env.VERTEX_VIDEO_LOCATION_RAPID || "us-central1")
          : asString(process.env.VERTEX_VIDEO_LOCATION_PRO || "global");

      const baseUrl = location === "global" ? "https://aiplatform.googleapis.com" : `https://${location}-aiplatform.googleapis.com`;

      if (taskId) {
        const operationName = taskId.startsWith("projects/")
          ? taskId
          : taskId.startsWith("operations/")
            ? `projects/${projectId}/locations/${location}/${taskId}`
            : `projects/${projectId}/locations/${location}/operations/${taskId}`;

        const statusUrl = `${baseUrl}/v1/${operationName}`;
        const statusResp = await fetch(statusUrl, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });

      const { raw, rawText, bodyEmpty } = await parseUpstream(statusResp);
      if (!statusResp.ok) {
        return res.status(500).json({
          ok: false,
          error: "video_status_failed",
          location,
          model,
          detail: {
            status: statusResp.status,
            endpoint: statusUrl,
            bodyEmpty,
            raw: raw ?? undefined,
            rawText,
          },
        });
      }

        const videoUrl = extractVideoUrl(raw);
        const done = Boolean(raw?.done);
        const failed = done && !!raw?.error;
        const status = failed ? "failed" : done ? "succeeded" : "running";

        return res.status(200).json({
          ok: true,
          taskId: operationName,
          location,
          model,
          status,
          videoUrl: videoUrl || undefined,
          raw,
        });
      }

      const imageUrl = asString(b.imageUrl || q.imageUrl);
      if (!imageUrl) {
        return res.status(400).json({ ok: false, error: "missing_image_url" });
      }

      const imageFetchHeaders: Record<string, string> = {};
      if (imageUrl.includes(".blob.vercel-storage.com") && process.env.BLOB_READ_WRITE_TOKEN) {
        imageFetchHeaders.Authorization = `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`;
      }

      const imgResp = await fetch(imageUrl, {
        headers: imageFetchHeaders,
      });
      if (!imgResp.ok) {
        return res.status(400).json({
          ok: false,
          error: "invalid_image_url",
          detail: { status: imgResp.status, imageUrl },
        });
      }

      const mimeType = asString(imgResp.headers.get("content-type") || "image/png") || "image/png";
      const imageBuffer = Buffer.from(await imgResp.arrayBuffer());
      if (imageBuffer.length === 0) {
        return res.status(400).json({ ok: false, error: "empty_image" });
      }
      if (imageBuffer.length > 8 * 1024 * 1024) {
        return res.status(400).json({ ok: false, error: "image_too_large", detail: "Image must be <= 8MB" });
      }

      const imageB64 = imageBuffer.toString("base64");
      const aspectRatio = asString(b.aspect_ratio || b.aspectRatio || q.aspect_ratio || q.aspectRatio || "16:9");
      const resolution = asString(b.resolution || q.resolution || "720p");
      const durationSeconds = Number(b.durationSeconds || b.duration || q.durationSeconds || q.duration || 8) || 8;
      const upscale = Boolean(b.upscale || q.upscale);

      const createUrl = `${baseUrl}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predictLongRunning`;
      const createPayload = {
        instances: [
          {
            prompt,
            image: {
              bytesBase64Encoded: imageB64,
              mimeType,
            },
          },
        ],
        parameters: {
          aspectRatio,
          resolution,
          durationSeconds,
          generateAudio: false,
          upscale,
        },
      };

      const createResp = await fetch(createUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createPayload),
      });

      const { raw, rawText, bodyEmpty } = await parseUpstream(createResp);
      if (!createResp.ok) {
        if (mode === "rapid") {
          const fallback = await thirdPartyRapidFallback({ prompt, imageUrl, aspectRatio, resolution });
          if (fallback.ok) {
            return res.status(200).json({
              ok: true,
              provider: "third_party_fallback",
              location,
              model,
              status: "submitted",
              fallback: true,
              raw: fallback.data,
            });
          }

          return res.status(500).json({
            ok: false,
            error: "video_create_failed",
            location,
            model,
            detail: {
              status: createResp.status,
              endpoint: createUrl,
              bodyEmpty,
              request: {
                aspectRatio,
                resolution,
                durationSeconds,
                upscale,
              },
              raw: raw ?? undefined,
              rawText,
            },
            fallbackError: fallback.error,
            hint: "Rapid failed. You can retry with Pro(global).",
          });
        }

        return res.status(500).json({
          ok: false,
          error: "video_create_failed",
          location,
          model,
          detail: {
            status: createResp.status,
            endpoint: createUrl,
            bodyEmpty,
            request: {
              aspectRatio,
              resolution,
              durationSeconds,
              upscale,
            },
            raw: raw ?? undefined,
            rawText,
          },
        });
      }

      const operationName = asString(raw?.name);
      const operationId = operationName.split("/").pop() || "";

      return res.status(200).json({
        ok: true,
        taskId: operationName || operationId,
        operationId,
        location,
        model,
        status: "running",
      });
    }

    return res.status(400).json({ ok: false, error: "unsupported_type" });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: "server_error", message: e?.message || String(e) });
  }
}
