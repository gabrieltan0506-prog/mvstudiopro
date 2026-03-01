import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

function json(res: VercelResponse, body: any, status = 200) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function base64url(input: Buffer | string) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return b.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getAccessTokenFromServiceAccount(scope: string) {
  const sa = JSON.parse(mustEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON"));
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(unsigned);
  sign.end();
  const signature = sign.sign(sa.private_key);
  const assertion = `${unsigned}.${base64url(signature)}`;

  const form = new URLSearchParams();
  form.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  form.set("assertion", assertion);

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const text = await r.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch {}
  if (!r.ok) return { ok: false, status: r.status, raw: j || text };
  return { ok: true, accessToken: j.access_token as string };
}

async function vertexGenerateImage(prompt: string, tier: "flash" | "pro") {
  const projectId = mustEnv("VERTEX_PROJECT_ID");
  const baseLocations = (process.env.VERTEX_LOCATIONS || process.env.VERTEX_LOCATION || "").toString().trim();
  if (!baseLocations) throw new Error("Missing env: VERTEX_LOCATION (or VERTEX_LOCATIONS)");
  const locations = baseLocations.split(",").map(s => s.trim()).filter(Boolean);
  const flashModel = (process.env.VERTEX_IMAGEN_FLASH_MODEL || "imagen-3.0-fast-generate-001").toString().trim();
  const proModel = (process.env.VERTEX_IMAGEN_PRO_MODEL || "imagen-4.0-generate-001").toString().trim();
  const model = tier === "pro" ? proModel : flashModel;

  const tok = await getAccessTokenFromServiceAccount("https://www.googleapis.com/auth/cloud-platform");
  if (!tok.ok) return { ok: false, stage: "oauth", detail: tok };

  for (const location of locations) {
    const url =
      `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
      `/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:predict`;

    const body = {
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: "1:1",
        addWatermark: true,
        enhancePrompt: false,
      },
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok.accessToken}` },
      body: JSON.stringify(body),
    });

    const ct = r.headers.get("content-type") || "";
    const text = await r.text();
    let j: any = null;
    try { j = ct.includes("application/json") ? JSON.parse(text) : null; } catch {}

    if (!r.ok) {
      // 404 继续尝试下一个 region；其它错误直接返回
      if (r.status === 404) continue;
      return { ok: false, stage: "imagen", status: r.status, raw: j || text, location, model };
    }

    const pred = j?.predictions?.[0];
    const b64 = pred?.bytesBase64Encoded;
    const mime = pred?.mimeType || "image/png";
    if (b64) {
      return { ok: true, imageUrl: `data:${mime};base64,${b64}`, location, model };
    }

    return { ok: false, stage: "imagen", error: "no_image_in_response", raw: j, location, model };
  }

  return { ok: false, stage: "imagen", error: "model_not_found_in_all_regions", locations, model };
}

async function aimusicCreate(model: "suno" | "udio", prompt: string, durationSec: number) {
  const base = mustEnv("AIMUSIC_BASE_URL");
  const key = mustEnv("AIMUSIC_API_KEY");
  const createPath = process.env.AIMUSIC_CREATE_PATH || "/producer/create";
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const url = `${b}${createPath.startsWith("/") ? createPath : `/${createPath}`}`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, prompt, duration: durationSec }),
  });

  const ct = r.headers.get("content-type") || "";
  const text = await r.text();
  let j: any = null;
  try { j = ct.includes("application/json") ? JSON.parse(text) : null; } catch {}
  if (!r.ok) return { ok: false, status: r.status, raw: j || text };
  return { ok: true, raw: j || text };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const body: any = req.body || {};
    const type = (body.type || req.query?.type || "").toString();
    const provider = (body.provider || req.query?.provider || "").toString().trim();

    if (type === "image") {
      const resolvedProvider = provider || "nano-banana-flash";
      const prompt = (body.prompt || req.query?.prompt || "").toString().trim();
      if (!prompt) return json(res, { ok: false, type: "image", error: "missing_prompt" }, 400);
      const tier: "flash" | "pro" = resolvedProvider === "nano-banana-pro" ? "pro" : "flash";
      const out = await vertexGenerateImage(prompt, tier);
      if (out.ok) return json(res, { ok: true, type: "image", provider: resolvedProvider, imageUrl: out.imageUrl, debugPromptEcho: prompt, debug: { location: out.location, model: out.model } });
      return json(res, { ok: false, type: "image", provider: resolvedProvider, error: "image_generation_failed", detail: out, debugPromptEcho: prompt }, 500);
    }

    if (type === "audio") {
      const prompt = (body.prompt || req.query?.prompt || "").toString().trim();
      const provider = (body.provider || req.query?.provider || "suno").toString();
      const duration = Number(body.duration || req.query?.duration || 60);
      if (!prompt) return json(res, { ok: false, type: "audio", error: "missing_prompt" }, 400);
      const out = await aimusicCreate(provider === "udio" ? "udio" : "suno", prompt, duration);
      return json(res, { ok: true, type: "audio", provider, ...out });
    }

    return json(res, { ok: false, error: "unsupported_type", type }, 400);
  } catch (e: any) {
    return json(res, { ok: false, error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
