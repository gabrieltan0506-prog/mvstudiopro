import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { setShortLink } from "./_core/shortlink-store";

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

function toVideoModel(provider: string, quality: string): "veo-3.1-fast-generate-preview" | "veo-3.1-generate-preview" {
  const p = provider.trim().toLowerCase();
  const q = quality.trim().toLowerCase();
  if (p.includes("fast") || q === "fast") return "veo-3.1-fast-generate-preview";
  return "veo-3.1-generate-preview";
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

    const typeRaw = asString(b.type || q.type);
    const taskIdRaw = asString(b.taskId || q.taskId);
    const providerRaw = asString(b.provider || (b.input && b.input.provider) || q.provider);
    const prompt = asString(b.prompt || (b.input && b.input.prompt) || q.prompt);
    const debug = asString(b.debug || q.debug) === "1";
    const inferredType = taskIdRaw ? "video" : (isVideoProvider(providerRaw) && prompt ? "video" : (prompt ? "image" : ""));
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

      const model =
        provider === "nano-banana-pro"
          ? asString(process.env.VERTEX_IMAGE_MODEL_PRO)
          : asString(process.env.VERTEX_IMAGE_MODEL_FLASH);

      if (!model) {
        return res.status(500).json({ ok: false, error: "missing_env", detail: "Missing VERTEX_IMAGE_MODEL_FLASH/PRO" });
      }

      const projectId = asString(process.env.VERTEX_PROJECT_ID);
      if (!projectId) {
        return res.status(500).json({ ok: false, error: "missing_env", detail: "Missing VERTEX_PROJECT_ID" });
      }

      const location = asString(process.env.VERTEX_LOCATION || "global");
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
          generationConfig: { responseModalities: ["IMAGE"] }
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
      const geminiKey = asString(process.env.GEMINI_API_KEY).trim();
      if (!geminiKey) {
        return res.status(500).json({ ok: false, type: "video", provider, error: "missing_env", detail: "Missing GEMINI_API_KEY" });
      }

      if (taskId) {
        const operationName = normalizeOperationName(taskId);
        const statusUrl = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${encodeURIComponent(geminiKey)}`;
        const upstream = await fetch(statusUrl, { method: "GET" });
        const json: any = await upstream.json().catch(() => ({}));
        if (!upstream.ok) {
          return res.status(500).json({
            ok: false,
            type: "video",
            provider,
            taskId,
            error: "video_status_failed",
            detail: { status: upstream.status, raw: json }
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
          raw: json
        });
      }

      if (!prompt) {
        return res.status(400).json({ ok: false, type: "video", provider, error: "missing_prompt" });
      }

      const quality = pickFirst(b.quality, q.quality);
      const aspectRatio = pickFirst(b.aspect_ratio, b.aspectRatio, q.aspect_ratio, q.aspectRatio) || "16:9";
      const resolution = pickFirst(b.resolution, q.resolution) || "720p";
      const negativePrompt = pickFirst(b.negativePrompt, b.negative_prompt, q.negativePrompt, q.negative_prompt);
      const model = toVideoModel(provider, quality);

      const createUrl =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateVideos` +
        `?key=${encodeURIComponent(geminiKey)}`;

      const createBody: any = {
        prompt,
        config: {
          numberOfVideos: 1,
          aspectRatio,
          resolution,
        }
      };
      if (negativePrompt) {
        createBody.config.negativePrompt = negativePrompt;
      }

      const upstream = await fetch(createUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createBody)
      });

      const json: any = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return res.status(500).json({
          ok: false,
          type: "video",
          provider,
          error: "video_create_failed",
          detail: { status: upstream.status, raw: json, model }
        });
      }

      const operationName = asString(json?.name);
      const createdTaskId = toTaskId(operationName);
      if (!createdTaskId) {
        return res.status(500).json({
          ok: false,
          type: "video",
          provider,
          error: "missing_task_id",
          detail: { raw: json, model }
        });
      }

      const out: any = {
        ok: true,
        type: "video",
        provider,
        taskId: createdTaskId,
        status: "running",
        raw: json
      };
      if (debug) out.debug = { model };
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
