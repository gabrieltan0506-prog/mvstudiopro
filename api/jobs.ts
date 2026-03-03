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
  if (!tokenRes.ok || !json?.access_token) throw new Error("Vertex token failed");
  return json.access_token;
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
      const aspectRatio = asString(b.aspectRatio || q.aspectRatio || "16:9");
      const model =
        imageProvider === "nano-banana-pro"
          ? "gemini-3-pro-image-preview"
          : "gemini-3.1-flash-image-preview";

      const location = asString(process.env.VERTEX_IMAGE_LOCATION || "global");
      const baseUrl = location === "global" ? "https://aiplatform.googleapis.com" : `https://${location}-aiplatform.googleapis.com`;
      const url = `${baseUrl}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

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
            imageConfig: {
              aspectRatio: imageProvider === "nano-banana-pro" ? aspectRatio : "16:9",
            },
          },
        }),
      });

      const json: any = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return res.status(500).json({
          ok: false,
          error: "image_generation_failed",
          detail: { status: upstream.status, raw: json, model, location },
        });
      }

      const parts = json?.candidates?.[0]?.content?.parts || [];
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
          detail: { model, location },
        });
      }

      return res.status(200).json({
        ok: true,
        provider: imageProvider,
        model,
        location,
        imageUrl: `data:image/png;base64,${base64img}`,
      });
    }

    if (type === "video") {
      const isRapid = provider === "veo-3.1-fast-generate-001" || provider === "veo_3_1_fast";
      const model = isRapid
        ? asString(process.env.VERTEX_VEO_MODEL_RAPID).trim()
        : asString(process.env.VERTEX_VEO_MODEL_PRO).trim();

      if (!model) {
        return res.status(500).json({
          ok: false,
          error: "missing_env",
          detail: isRapid ? "Missing VERTEX_VEO_MODEL_RAPID" : "Missing VERTEX_VEO_MODEL_PRO",
        });
      }

      const location = isRapid ? asString(process.env.VERTEX_VIDEO_LOCATION || "us-central1") : "global";
      const baseUrl = location === "global" ? "https://aiplatform.googleapis.com" : `https://${location}-aiplatform.googleapis.com`;

      if (taskId) {
        const statusTaskId = taskId.replace(/^operations\//, "");
        const url = `${baseUrl}/v1/operations/${statusTaskId}`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const j: any = await r.json().catch(() => ({}));
        if (!r.ok) {
          return res.status(500).json({ ok: false, error: "video_status_failed", location, model, detail: j });
        }
        return res.status(200).json({ ok: true, taskId: statusTaskId, location, model, raw: j });
      }

      const image = asString(b.imageDataUrl || b.image || q.imageDataUrl || q.image);
      if (!image) {
        return res.status(400).json({ ok: false, error: "missing_image" });
      }

      const imgMatch = image.match(/^data:(.+);base64,(.+)$/);
      if (!imgMatch) {
        return res.status(400).json({ ok: false, error: "invalid_image" });
      }
      const imageB64 = imgMatch[2];

      const url = `${baseUrl}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateVideos`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          image: { imageBytes: imageB64, mimeType: "image/png" },
          config: {
            durationSeconds: 8,
            generateAudio: false,
            aspectRatio: asString(b.aspect_ratio || b.aspectRatio || q.aspect_ratio || q.aspectRatio || "16:9"),
            resolution: asString(b.resolution || q.resolution || "720p"),
          },
        }),
      });

      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(500).json({
          ok: false,
          error: "video_create_failed",
          location,
          model,
          detail: j,
        });
      }

      const operation = asString(j?.name).replace(/^operations\//, "");
      return res.status(200).json({
        ok: true,
        taskId: operation,
        location,
        model,
      });
    }

    return res.status(400).json({ ok: false, error: "unsupported_type" });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: "server_error", message: e?.message || String(e) });
  }
}
