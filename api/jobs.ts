import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";

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
    const prompt = asString(b.prompt || (b.input && b.input.prompt) || q.prompt);
    const provider = asString(b.provider || (b.input && b.input.provider) || q.provider || "nano-banana-flash");
    const debug = asString(b.debug || q.debug) === "1";

    const type = typeRaw || (prompt ? "image" : "");

    if (!type && !prompt) {
      return res.status(200).json({ ok: true, message: "jobs endpoint reachable" });
    }
    if (type !== "image") {
      return res.status(400).json({ ok: false, error: "unsupported_type", type });
    }
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
        generationConfig: { responseMimeType: "image/png" }
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
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: e?.message || String(e)
    });
  }
}
