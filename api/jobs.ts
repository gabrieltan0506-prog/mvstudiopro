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

function asNumber(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getKlingConfig() {
  const baseUrl = asString(process.env.KLING_CN_BASE_URL || "https://api-beijing.klingai.com").replace(/\/$/, "");
  const accessKey = asString(process.env.KLING_CN_VIDEO_ACCESS_KEY).trim();
  const secretKey = asString(process.env.KLING_CN_VIDEO_SECRET_KEY).trim();
  if (!accessKey || !secretKey) {
    throw new Error("Missing KLING_CN_VIDEO_ACCESS_KEY or KLING_CN_VIDEO_SECRET_KEY");
  }
  return { baseUrl, accessKey, secretKey };
}

function toBase64Url(value: Buffer): string {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createKlingJwt(accessKey: string, secretKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { iss: accessKey, exp: now + 1800, nbf: now - 5, iat: now };
  const headerB64 = toBase64Url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = toBase64Url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = crypto.createHmac("sha256", secretKey).update(signingInput).digest();
  return `${signingInput}.${toBase64Url(signature)}`;
}

async function klingRequest(path: string, method: "GET" | "POST", body?: Record<string, unknown>) {
  const { baseUrl, accessKey, secretKey } = getKlingConfig();
  const token = createKlingJwt(accessKey, secretKey);
  const url = `${baseUrl}${path}`;

  const upstream = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });

  const json: any = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    throw new Error(`Kling HTTP ${upstream.status}: ${JSON.stringify(json)}`);
  }
  if (typeof json?.code === "number" && json.code !== 0) {
    throw new Error(`Kling API ${json.code}: ${json?.message || "unknown error"}`);
  }
  return json;
}

async function createKlingImageTask(payload: {
  prompt: string;
  modelName?: string;
  resolution?: string;
  aspectRatio?: string;
  count?: number;
  negativePrompt?: string;
}) {
  const request: Record<string, unknown> = {
    model_name: payload.modelName || "kling-image-o1",
    prompt: payload.prompt,
    resolution: payload.resolution || "1k",
    aspect_ratio: payload.aspectRatio || "1:1",
    n: payload.count && payload.count > 0 ? Math.floor(payload.count) : 1,
  };
  if (payload.negativePrompt) request.negative_prompt = payload.negativePrompt;
  return klingRequest("/v1/images/generations", "POST", request);
}

async function getKlingImageTask(taskId: string) {
  return klingRequest(`/v1/images/generations/${encodeURIComponent(taskId)}`, "GET");
}

async function createKlingVideoTask(payload: {
  prompt: string;
  modelName?: string;
  mode?: string;
  aspectRatio?: string;
  duration?: string;
  negativePrompt?: string;
}) {
  const request: Record<string, unknown> = {
    model_name: payload.modelName || "kling-v3-omni",
    prompt: payload.prompt,
    mode: payload.mode || "std",
    aspect_ratio: payload.aspectRatio || "16:9",
    duration: payload.duration || "5",
    cfg_scale: 0.5,
  };
  if (payload.negativePrompt) request.negative_prompt = payload.negativePrompt;
  return klingRequest("/v1/videos/omni-video", "POST", request);
}

async function getKlingVideoTask(taskId: string) {
  return klingRequest(`/v1/videos/omni-video/${encodeURIComponent(taskId)}`, "GET");
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
    const taskId = asString(b.taskId || q.taskId);

    const type = typeRaw || (prompt ? "image" : "");
    const action = asString((b.input && b.input.action) || b.action);
    const params = (b.input && b.input.params && typeof b.input.params === "object") ? b.input.params : (typeof b.params === "object" ? b.params : {});
    const klingLikeProvider =
      provider === "kling_image" ||
      provider === "kling-cn" ||
      provider === "kling_beijing" ||
      provider === "kling_video";

    if (req.method === "GET" && taskId && klingLikeProvider) {
      if (provider === "kling_image") {
        const st: any = await getKlingImageTask(taskId);
        const data = st?.data || {};
        const images = Array.isArray(data?.task_result?.images) ? data.task_result.images : [];
        const urls = images.map((x: any) => asString(x?.url)).filter(Boolean);
        return res.status(200).json({
          ok: true,
          type: "image",
          provider,
          taskId,
          taskStatus: asString(data?.task_status || ""),
          imageUrl: urls[0] || "",
          images: urls,
          raw: st,
        });
      }

      const st: any = await getKlingVideoTask(taskId);
      const data = st?.data || {};
      const videos = Array.isArray(data?.task_result?.videos) ? data.task_result.videos : [];
      const videoUrl = asString(videos?.[0]?.url);
      return res.status(200).json({
        ok: true,
        type: "video",
        provider,
        taskId,
        taskStatus: asString(data?.task_status || ""),
        videoUrl: videoUrl || "",
        raw: st,
      });
    }

    if (klingLikeProvider && prompt && (type === "video" || action === "omni_t2v" || provider === "kling_beijing" || provider === "kling_video")) {
      const modelName = asString((params as any).modelName || b.modelName || b.model_name || q.modelName || q.model_name || "kling-v3-omni");
      const mode = asString((params as any).mode || b.mode || q.mode || "std");
      const aspectRatio = asString((params as any).aspectRatio || b.aspectRatio || b.aspect_ratio || q.aspectRatio || q.aspect_ratio || "16:9");
      const duration = asString((params as any).duration || b.duration || q.duration || "5");
      const negativePrompt = asString((params as any).negativePrompt || b.negativePrompt || b.negative_prompt || q.negativePrompt || q.negative_prompt);
      const created: any = await createKlingVideoTask({
        prompt,
        modelName,
        mode,
        aspectRatio,
        duration,
        negativePrompt: negativePrompt || undefined,
      });
      return res.status(200).json({
        ok: true,
        type: "video",
        provider,
        taskId: asString(created?.data?.task_id),
        status: "queued",
        raw: created,
      });
    }

    if (klingLikeProvider && prompt && (type === "image" || action === "kling_image" || provider === "kling_image")) {
      const modelName = asString((params as any).model || b.model || b.modelName || b.model_name || q.model || q.modelName || q.model_name || "kling-image-o1");
      const resolution = asString((params as any).resolution || b.resolution || q.resolution || "1k");
      const aspectRatio = asString((params as any).aspectRatio || b.aspectRatio || b.aspect_ratio || q.aspectRatio || q.aspect_ratio || "1:1");
      const count = asNumber((params as any).count ?? b.count ?? b.n ?? q.count ?? q.n) ?? 1;
      const negativePrompt = asString((params as any).negativePrompt || b.negativePrompt || b.negative_prompt || q.negativePrompt || q.negative_prompt);
      const created: any = await createKlingImageTask({
        prompt,
        modelName,
        resolution,
        aspectRatio,
        count,
        negativePrompt: negativePrompt || undefined,
      });
      return res.status(200).json({
        ok: true,
        type: "image",
        provider,
        taskId: asString(created?.data?.task_id),
        status: "queued",
        raw: created,
      });
    }

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
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: e?.message || String(e)
    });
  }
}
