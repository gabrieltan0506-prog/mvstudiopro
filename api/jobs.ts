import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { put } from "@vercel/blob";

function s(v: any): string { if (v == null) return ""; if (Array.isArray(v)) return String(v[0] ?? ""); return String(v); }
function jparse(t: string): any { try { return JSON.parse(t); } catch { return null; } }
function body(req: VercelRequest): any {
  if (!req.body) return {};
  if (typeof req.body === "string") return jparse(req.body) ?? {};
  return req.body;
}

function safeJsonParse(t: string): any { try { return JSON.parse(t); } catch { return null; } }
function getBody(req: VercelRequest): any {
  const b: any = (req as any).body;
  if (!b) return {};
  if (typeof b === "string") return safeJsonParse(b) ?? {};
  return b;
}

function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function jwtHS256(iss: string, secret: string) {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf-8"));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(Buffer.from(JSON.stringify({ iss, iat: now, nbf: now, exp: now + 3600 }), "utf-8"));
  const unsigned = `${header}.${payload}`;
  const sig = crypto.createHmac("sha256", secret).update(unsigned).digest();
  return `${unsigned}.${b64url(sig)}`;
}
async function fetchJson(url: string, init: RequestInit) {
  const r = await fetch(url, init);
  const text = await r.text();
  const json = jparse(text);
  return { ok: r.ok, status: r.status, url, json, rawText: text.slice(0, 4000) };
}

async function fetchImageAsBase64(imageUrl: string): Promise<{ b64: string; bytes: number; mime: string }> {
  const url = String(imageUrl || "").trim();
  if (!url) throw new Error("missing_image_url");

  const token = s(process.env.BLOB_READ_WRITE_TOKEN).trim();

  async function doFetch(withAuth: boolean) {
    const headers: Record<string, string> = { "User-Agent": "mvstudiopro/1.0 (+image-fetch)" };
    if (withAuth && token) headers["Authorization"] = `Bearer ${token}`;
    return await fetch(url, { redirect: "follow", headers });
  }

  let resp = await doFetch(false);
  if (resp.status === 403 && token) resp = await doFetch(true);
  if (!resp.ok) throw new Error(`image_fetch_failed:${resp.status}`);

  const mime = String(resp.headers.get("content-type") || "image/png");
  const ab = await resp.arrayBuffer();
  const buf = Buffer.from(ab);
  if (!buf.length) throw new Error("empty_image");
  if (buf.length > 10 * 1024 * 1024) throw new Error("image_too_large");
  return { b64: buf.toString("base64"), bytes: buf.length, mime };
}


async function getVertexAccessToken(): Promise<string> {
  const raw = s(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON).trim();
  if (!raw) throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS_JSON");

  const sa: any = safeJsonParse(raw);
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

  const json: any = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !json?.access_token) throw new Error(`Vertex token failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

function normalizePredictOperationName(taskIdOrName: string, projectId: string, location: string, model: string): string {
  const input = String(taskIdOrName || "").trim();
  if (!input) return "";
  if (input.startsWith(`projects/${projectId}/locations/${location}/publishers/google/models/${model}/operations/`)) return input;
  const m = input.match(/operations\/([^/?\s]+)/);
  if (m?.[1]) return `projects/${projectId}/locations/${location}/publishers/google/models/${model}/operations/${m[1]}`;
  return `projects/${projectId}/locations/${location}/publishers/google/models/${model}/operations/${input}`;
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
    const v = String(item || "").trim();
    if (v) return v;
  }
  return "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // ------------------------------------------------------------------
    // COMPAT: Legacy Vertex/Veo API for TestLab (type=image|video)
    // If op is not provided, we keep supporting the old interface.
    // ------------------------------------------------------------------
    const q: any = req.query || {};
    const b: any = req.method === "POST" ? getBody(req) : {};
    const op = s(q.op || b.op).trim();

    if (!op) {
      const type = s(q.type || b.type).trim();

      if (type === "video") {
        // Supports:
        // - POST: create (requires imageUrl + prompt)
        // - GET:  status (requires taskId + provider)
        const provider = s(q.provider || b.provider || "pro").toLowerCase(); // rapid|pro
        const prompt = s(q.prompt || b.prompt || "");
        const taskId = s(q.taskId || b.taskId || "");

        const projectId = s(process.env.VERTEX_PROJECT_ID).trim();
        if (!projectId) return res.status(500).json({ ok: false, error: "missing_env", detail: "Missing VERTEX_PROJECT_ID" });

        const token = await getVertexAccessToken();

        const mode = provider.includes("rapid") || provider.includes("fast") ? "rapid" : "pro";
        const model = mode === "rapid"
          ? s(process.env.VERTEX_VEO_MODEL_RAPID || "veo-3.1-fast-generate-001")
          : s(process.env.VERTEX_VEO_MODEL_PRO || "veo-3.1-generate-001");

        const location = mode === "rapid"
          ? s(process.env.VERTEX_VIDEO_LOCATION_RAPID || "us-central1")
          : s(process.env.VERTEX_VIDEO_LOCATION_PRO || "global");

        const baseUrl = location === "global" ? "https://aiplatform.googleapis.com" : `https://${location}-aiplatform.googleapis.com`;

        if (req.method === "GET" && taskId) {
          const operationName = normalizePredictOperationName(taskId, projectId, location, model);
          const statusUrl = `${baseUrl}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:fetchPredictOperation`;
          const statusResp = await fetch(statusUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ operationName }),
          });

          const text = await statusResp.text();
          const raw = safeJsonParse(text);
          if (!statusResp.ok) {
            return res.status(502).json({ ok: false, error: "video_status_failed", status: statusResp.status, raw: raw ?? text.slice(0, 800) });
          }

          const videoUrl = extractVideoUrl(raw);
          const done = Boolean(raw?.done);
          const failed = done && !!raw?.error;
          const status = failed ? "failed" : done ? "succeeded" : "running";

          return res.status(200).json({ ok: true, status, taskId: operationName, videoUrl: videoUrl || undefined, raw });
        }

        if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
        const imageUrl = s(q.imageUrl || b.imageUrl);
        if (!imageUrl) return res.status(400).json({ ok: false, error: "missing_image_url" });

        // server fetch image (supports private blob with token)
        const blobToken = s(process.env.BLOB_READ_WRITE_TOKEN).trim();
        const headers: any = { "User-Agent": "mvstudiopro/1.0 (+veo-fetch)" };
        let imgResp = await fetch(imageUrl, { redirect: "follow", headers });
        if (imgResp.status === 403 && blobToken) {
          headers["Authorization"] = `Bearer ${blobToken}`;
          imgResp = await fetch(imageUrl, { redirect: "follow", headers });
        }
        if (!imgResp.ok) return res.status(400).json({ ok: false, error: "invalid_image_url", status: imgResp.status });

        const mimeType = String(imgResp.headers.get("content-type") || "image/png");
        const buf = Buffer.from(await imgResp.arrayBuffer());
        if (!buf.length) return res.status(400).json({ ok: false, error: "empty_image" });
        if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ ok: false, error: "image_too_large" });

        const imageB64 = buf.toString("base64");

        const durationSeconds = Number(q.durationSeconds || b.durationSeconds || q.duration || b.duration || 8) || 8;
        const aspectRatio = s(q.aspectRatio || b.aspectRatio || "16:9");
        const resolution = s(q.resolution || b.resolution || "720p");

        const createUrl = `${baseUrl}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predictLongRunning`;
        const createResp = await fetch(createUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            instances: [{ prompt, image: { bytesBase64Encoded: imageB64, mimeType } }],
            parameters: { aspectRatio, resolution, durationSeconds, generateAudio: false, upscale: false },
          }),
        });

        const text = await createResp.text();
        const raw = safeJsonParse(text);
        if (!createResp.ok) {
          return res.status(502).json({ ok: false, error: "video_create_failed", status: createResp.status, raw: raw ?? text.slice(0, 800) });
        }

        const name = String(raw?.name || "");
        return res.status(200).json({ ok: true, status: "running", taskId: name, raw });
      }

      // Unknown legacy type
      return res.status(400).json({ ok: false, error: "unsupported_type", type });
    }

    // NOTE: if op exists, continue with op-router below
    if (!op) return res.status(400).json({ ok: false, error: "missing op" });

    // ---------- blobPutImage (private store) ----------
    if (op === "blobPutImage") {
      const dataUrl = s(b.dataUrl);
      const filename = s(b.filename || "ref.png") || "ref.png";
      if (!dataUrl.startsWith("data:")) return res.status(400).json({ ok: false, error: "missing_data_url" });

      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return res.status(400).json({ ok: false, error: "invalid_data_url" });

      const mime = m[1];
      const b64 = m[2];
      const buf = Buffer.from(b64, "base64");
      if (!buf.length) return res.status(400).json({ ok: false, error: "empty_file" });
      if (buf.length > 10 * 1024 * 1024) return res.status(400).json({ ok: false, error: "file_too_large" });

      // store is private; do NOT use public
      const blob = await put(`refs/${Date.now()}-${filename}`, buf, { access: "private", contentType: mime });
      // Vercel private blob download link works with ?download=1
      const imageUrl = `${blob.url}?download=1`;
      return res.status(200).json({ ok: true, imageUrl, blobUrl: blob.url });
    }

    // ---------- Kling (video key only) ----------
    const KLING_BASE = (s(process.env.KLING_CN_BASE_URL) || "https://api-beijing.klingai.com").replace(/\/+$/, "");
    const VAK = s(process.env.KLING_CN_VIDEO_ACCESS_KEY).trim();
    const VSK = s(process.env.KLING_CN_VIDEO_SECRET_KEY).trim();

    // ---------- AIMusic (Suno) ----------
    const AIM_BASE = (s(process.env.AIMUSIC_BASE_URL) || "https://api.aimusicapi.ai").replace(/\/+$/, "");
    const AIM_KEY = s(process.env.AIMUSIC_API_KEY || process.env.AIMUSICAPI_KEY).trim();

    if (op === "aimusicSunoCreate") {
      if (!AIM_KEY) return res.status(500).json({ ok: false, error: "missing_env", detail: "Missing AIMUSIC_API_KEY" });
      const payload = {
        task_type: "create_music",
        custom_mode: false,
        mv: "sonic-v4-5",
        gpt_description_prompt: s(b.prompt || q.prompt || "")
      };
      const r = await fetchJson(`${AIM_BASE}/api/v1/sonic/create`, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + AIM_KEY,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(payload)
      });
      return res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, url: r.url, raw: r.json ?? r.rawText });
    }

    if (op === "aimusicSunoTask") {
      if (!AIM_KEY) return res.status(500).json({ ok: false, error: "missing_env", detail: "Missing AIMUSIC_API_KEY" });
      const taskId = s(q.taskId || q.task_id || b.taskId || b.task_id).trim();
      if (!taskId) return res.status(400).json({ ok: false, error: "missing_task_id" });

      const r = await fetchJson(`${AIM_BASE}/api/v1/sonic/task/${encodeURIComponent(taskId)}`, {
        method: "GET",
        headers: {
          "Authorization": "Bearer " + AIM_KEY,
          "Accept": "application/json"
        }

    if (op === "aimusicUdioCreate") {
      if (!AIM_KEY) return res.status(500).json({ ok: false, error: "missing_env", detail: "Missing AIMUSIC_API_KEY" });
      const payload = {
        task_type: "create_music",
        sound: s(b.sound || b.prompt || q.prompt || ""),
        make_instrumental: (b.make_instrumental !== undefined) ? b.make_instrumental : true,
        mv: s(b.mv || "FUZZ-2.0")
      };
      const r = await fetchJson(`${AIM_BASE}/api/v1/producer/create`, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + AIM_KEY,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(payload)
      });
      return res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, url: r.url, raw: r.json ?? r.rawText });
    }

    if (op === "aimusicUdioTask") {
      if (!AIM_KEY) return res.status(500).json({ ok: false, error: "missing_env", detail: "Missing AIMUSIC_API_KEY" });
      const taskId = s(q.taskId || q.task_id || b.taskId || b.task_id).trim();
      if (!taskId) return res.status(400).json({ ok: false, error: "missing_task_id" });

      const r = await fetchJson(`${AIM_BASE}/api/v1/producer/task/${encodeURIComponent(taskId)}`, {
        method: "GET",
        headers: {
          "Authorization": "Bearer " + AIM_KEY,
          "Accept": "application/json"
        }
      });
      return res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, url: r.url, raw: r.json ?? r.rawText });
    }
      });
      return res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, url: r.url, raw: r.json ?? r.rawText });
    }

    // Keep Kling ops if env exists (so Remix doesn't break); otherwise return missing env.
    if (op === "klingCreate") {
      if (!VAK || !VSK) return res.status(500).json({ ok: false, error: "missing_env", detail: "Missing KLING_CN_VIDEO_ACCESS_KEY/SECRET_KEY" });
      const token = jwtHS256(VAK, VSK);

      const imageUrl = s(b.imageUrl || q.imageUrl).trim();
      if (!imageUrl) return res.status(400).json({ ok: false, error: "missing_image_url" });

      const prompt = s(b.prompt || q.prompt || "");
      const duration = s(b.duration || "10");
      if (duration !== "5" && duration !== "10") return res.status(400).json({ ok: false, error: "invalid_duration", detail: duration });

      // server-side fetch + base64 (avoid Kling fetching private URL)
      const img = await fetchImageAsBase64(imageUrl);

      const payload = {
        model_name: s(b.model_name || "kling-v3"),
        image: img.b64,
        prompt,
        duration,
        mode: s(b.mode || "pro"),
        sound: s(b.sound || "off")
      };

      const r = await fetchJson(`${KLING_BASE}/v1/videos/image2video`, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const taskId = r.json?.data?.task_id || null;
      return res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, url: r.url, taskId, imageInputMode: "base64", imageBytes: img.bytes, raw: r.json ?? r.rawText });
    }

    if (op === "klingTask") {
      if (!VAK || !VSK) return res.status(500).json({ ok: false, error: "missing_env", detail: "Missing KLING_CN_VIDEO_ACCESS_KEY/SECRET_KEY" });
      const token = jwtHS256(VAK, VSK);

      const taskId = s(q.taskId || q.task_id || b.taskId || b.task_id).trim();
      if (!taskId) return res.status(400).json({ ok: false, error: "missing_task_id" });

      const r = await fetchJson(`${KLING_BASE}/v1/videos/image2video/${encodeURIComponent(taskId)}`, {
        method: "GET",
        headers: { "Authorization": "Bearer " + token, "Accept": "application/json" }
      });

      const taskStatus = s(r.json?.data?.task_status || "");
      const videoUrl = r.json?.data?.task_result?.videos?.[0]?.url || null;
      return res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, url: r.url, taskStatus, videoUrl, raw: r.json ?? r.rawText });
    }

    return res.status(400).json({ ok: false, error: "unknown_op", op });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: "server_error", message: e?.message || String(e) });
  }
}
