import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function joinUrl(base: string, path: string) {
  const b = base.replace(/\/+$, "");
  const p = (path || "").startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

async function aimusicCreate(model: "suno" | "udio", prompt: string, durationSec: number) {
  const base = mustEnv("AIMUSIC_BASE_URL");
  const key = mustEnv("AIMUSIC_API_KEY");
  const createPath = process.env.AIMUSIC_CREATE_PATH || "/producer/create";
  const url = joinUrl(base, createPath);
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

async function aimusicStatus(taskId: string) {
  const base = mustEnv("AIMUSIC_BASE_URL");
  const key = mustEnv("AIMUSIC_API_KEY");
  const statusPath = process.env.AIMUSIC_STATUS_PATH || "/producer/status";
  const url = statusPath.includes("{taskId}")
    ? joinUrl(base, statusPath.replace("{taskId}", encodeURIComponent(taskId)))
    : joinUrl(base, `${statusPath}?taskId=${encodeURIComponent(taskId)}`);
  const r = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${key}` } });
  const ct = r.headers.get("content-type") || "";
  const text = await r.text();
  let j: any = null;
  try { j = ct.includes("application/json") ? JSON.parse(text) : null; } catch {}
  if (!r.ok) return { ok: false, status: r.status, raw: j || text };
  return { ok: true, raw: j || text };
}

function json(res: VercelResponse, body: any) {
  res.status(200);
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
  const raw = mustEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON");
  const sa = JSON.parse(raw);

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

  const t = await r.text();
  let j: any = null;
  try { j = JSON.parse(t); } catch {}

  if (!r.ok) {
    return { ok: false, status: r.status, raw: j || t };
  }

  return { ok: true, accessToken: j.access_token as string, raw: j };
}

async function vertexGenerateImage(prompt: string) {
  const projectId = mustEnv("VERTEX_PROJECT_ID");
  const location = mustEnv("VERTEX_LOCATION");

  // 你可以在 Vercel env 覆盖这个模型名
  // 常见：gemini-2.0-flash / gemini-2.5-flash / gemini-2.5-pro
  // 注意：不同账号/区域对“返回图片”支持不同；若模型不支持，会在 raw 里看到明确错误
  const model = process.env.VERTEX_IMAGE_MODEL || "gemini-2.5-flash";

  const token = await getAccessTokenFromServiceAccount("https://www.googleapis.com/auth/cloud-platform");
  if (!token.ok) return { ok: false, stage: "oauth", detail: token };

  const url =
    `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;

  // 说明：Vertex 的 Gemini “返回图片”能力与具体模型/参数有关；
  // 这里先按最通用的 generateContent 请求发起，返回 raw 供你确认是否含图片数据。
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token.accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const ct = r.headers.get("content-type") || "";
  const text = await r.text();
  let j: any = null;
  try { j = ct.includes("application/json") ? JSON.parse(text) : null; } catch {}

  if (!r.ok) return { ok: false, stage: "vertex", status: r.status, raw: j || text };

  // 尝试从返回里找 inlineData（如果模型支持图片输出）
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const inline = parts.find((p: any) => p?.inlineData?.data);
  if (inline?.inlineData?.data) {
    const mime = inline.inlineData.mimeType || "image/png";
    return { ok: true, imageUrl: `data:${mime};base64,${inline.inlineData.data}`, raw: j };
  }

  return { ok: false, stage: "vertex", error: "no_image_in_response", raw: j };
}

function normalizeProvider(x: any): string {
  const raw = (x ?? "").toString().trim();
  const map: Record<string, string> = {
    "nano_flash": "nano-banana-flash",
    "nano-banana-flash": "nano-banana-flash",
    "nano-banana-pro": "nano-banana-pro",
    "kling_image": "kling_image",
    "kling_beijing": "kling_beijing",
    "kling": "kling_beijing",
  };
  return map[raw] || raw;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const body: any = req.body || {};
    const type = (body.type || req.query?.type || body.input?.type || "").toString();
    const provider = normalizeProvider(
      req.query?.provider ?? body.provider ?? body.input?.provider ?? body.job?.provider ?? body.payload?.provider
    );

    
  if (type === "audio") {
    
    const prompt = body.prompt || req.query?.prompt;
    const provider = body.provider || req.query?.provider || "suno";
    const duration = Number(body.duration || req.query?.duration || 60);
    const r = await aimusicCreate((provider === "udio" ? "udio" : "suno"), String(prompt||""), duration);
    return res.json(r);
  }

  if (type === "image") {
      const resolvedProvider = provider || "nano-banana-flash";
      const prompt = (body.input?.prompt ?? body.prompt ?? req.query?.prompt ?? "").toString().trim();
      if (!prompt) return json(res, { ok: false, type: "image", error: "missing_prompt" });

      const out = await vertexGenerateImage(prompt);

      if (out.ok) {
        return json(res, {
          ok: true,
          type: "image",
          provider: resolvedProvider,
          imageUrl: out.imageUrl,
          debug: { resolvedProvider, vertexModel: process.env.VERTEX_IMAGE_MODEL || "gemini-2.5-flash" },
        });
      }

      return json(res, {
        ok: false,
        type: "image",
        provider: resolvedProvider,
        error: "image_generation_failed",
        detail: out,
        debug: { resolvedProvider, vertexModel: process.env.VERTEX_IMAGE_MODEL || "gemini-2.5-flash" },
      });
    }

    return json(res, { ok: false, error: "unsupported_type", type, provider });
  } catch (e: any) {
    return json(res, { ok: false, error: "server_error", detail: String(e?.message || e) });
  }
}
