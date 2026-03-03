import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";

function asString(v: any): string {
  if (v == null) return "";
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

async function getVertexAccessToken(): Promise<string> {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON!;
  const sa = JSON.parse(raw);
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

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const j: any = await r.json();
  if (!j.access_token) throw new Error("Vertex token failed");
  return j.access_token;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false });
    }

    const body: any = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const provider = asString(body.provider);
    const taskId = asString(body.taskId);
    const image = asString(body.imageDataUrl);

    const projectId = process.env.VERTEX_PROJECT_ID!;
    const token = await getVertexAccessToken();

    // === MODEL + REGION ROUTING ===
    const isRapid = provider === "veo-3.1-fast-generate-001";
    const model = isRapid
      ? process.env.VERTEX_VEO_MODEL_RAPID!
      : process.env.VERTEX_VEO_MODEL_PRO!;

    const location = isRapid
      ? process.env.VERTEX_VIDEO_LOCATION || "us-central1"
      : "global";

    const baseUrl = location === "global"
      ? "https://aiplatform.googleapis.com"
      : `https://${location}-aiplatform.googleapis.com`;

    // === STATUS POLL ===
    if (taskId) {
      const url = `${baseUrl}/v1/operations/${taskId}`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const j = await r.json();
      return res.status(200).json({ ok: true, raw: j });
    }

    // === CREATE (I2V ONLY) ===
    if (!image) {
      return res.status(400).json({ ok: false, error: "missing_image" });
    }

    const imgMatch = image.match(/^data:(.+);base64,(.+)$/);
    if (!imgMatch) {
      return res.status(400).json({ ok: false, error: "invalid_image" });
    }

    const mimeType = imgMatch[1];
    const imageB64 = imgMatch[2];

    const url = `${baseUrl}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateVideos`;

    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: body.prompt || "",
        referenceImage: {
          bytesBase64Encoded: imageB64
        },
        config: {
          durationSeconds: 8,
          generateAudio: false,
          aspectRatio: body.aspect_ratio || "16:9",
          resolution: body.resolution || "720p"
        }
      })
    });

    const j = await r.json();
    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        error: "video_create_failed",
        location,
        model,
        detail: j
      });
    }

    const operation = j.name?.replace("operations/", "");
    return res.status(200).json({
      ok: true,
      taskId: operation,
      location,
      model
    });

  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e.message
    });
  }
}
