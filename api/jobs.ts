import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { createRunState } from "./_core/workflow/engine.js";
import { newRunId, nowIso } from "./_core/workflow/store.js";
import { signUpgradeToken, verifyUpgradeToken, todayYYYYMMDD } from "./_core/upgrade_token.js";
import { put } from "@vercel/blob";

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

function getAimusicBaseUrl(): string {
  return (asString(process.env.AIMUSIC_BASE_URL).trim() || "https://api.aimusicapi.ai").replace(/\/+$/, "");
}
function getAimusicKey(): string {
  const k = asString(process.env.AIMUSIC_API_KEY || process.env.AIMUSICAPI_KEY).trim();
  if (!k) throw new Error("Missing AIMUSIC_API_KEY");
  return k;
}
async function aimusicRequest(path: string, init: RequestInit): Promise<{ ok: boolean; status: number; url: string; json?: any; rawText?: string }> {
  const base = getAimusicBaseUrl();
  const url = `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const resp = await fetch(url, init);
  const text = await resp.text();
  const rawText = text.slice(0, 4000);
  const raw = safeJsonParse(text);
  if (!raw) return { ok: false, status: resp.status, url, rawText };
  return { ok: resp.ok, status: resp.status, url, json: raw };
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

  if (raw?.response?.videos?.[0]?.bytesBase64Encoded) {
    const base64 = raw.response.videos[0].bytesBase64Encoded;
    return `data:video/mp4;base64,${base64}`;
  }

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
    if (!item) continue;
    const v = String(item).trim();
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

function normalizeOperationName(taskIdOrName: string, projectId: string, location: string): string {
  const input = asString(taskIdOrName).trim();
  if (!input) return "";

  // Always extract the operation id if the string contains an operations path.
  // This avoids invalid polling URLs like:
  // projects/.../publishers/google/models/.../operations/{id}
  const m = input.match(/operations\/([^/?\s]+)/);
  if (m?.[1]) {
    return `projects/${projectId}/locations/${location}/operations/${m[1]}`;
  }

  // If it's already a full canonical operation path, keep as-is.
  if (input.startsWith(`projects/${projectId}/locations/${location}/operations/`)) {
    return input;
  }

  // Fallback: treat as a raw operation id.
  return `projects/${projectId}/locations/${location}/operations/${input}`;
}

function normalizePredictOperationName(taskIdOrName: string, projectId: string, location: string, model: string): string {
  const input = asString(taskIdOrName).trim();
  if (!input) return "";

  // Already full publisher-scoped predict operation name.
  if (
    input.startsWith(`projects/${projectId}/locations/${location}/publishers/google/models/${model}/operations/`)
  ) {
    return input;
  }

  // If includes an operations path anywhere, extract the operation id and rebuild.
  const m = input.match(/operations\/([^/?\s]+)/);
  if (m?.[1]) {
    return `projects/${projectId}/locations/${location}/publishers/google/models/${model}/operations/${m[1]}`;
  }

  // Raw operation id.
  return `projects/${projectId}/locations/${location}/publishers/google/models/${model}/operations/${input}`;
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
  /* OP_ROUTER_V1 */
  const op = asString((req.query as any)?.op || "");
  if (op) {
    try {
      const body: any = req.method === "POST" ? getBody(req) : {};
      // 1) Upload image to Vercel Blob
      if (op === "blobPutImage") {
        const dataUrl = asString(body.dataUrl);
        const filename = asString(body.filename || "ref.png") || "ref.png";
        if (!dataUrl.startsWith("data:")) return res.status(400).json({ ok: false, error: "missing_data_url" });

        const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!m) return res.status(400).json({ ok: false, error: "invalid_data_url" });

        const mime = m[1];
        const b64 = m[2];
        const buf = Buffer.from(b64, "base64");
        if (!buf.length) return res.status(400).json({ ok: false, error: "empty_file" });
        if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ ok: false, error: "file_too_large" });

        const blob = await put(`refs/${Date.now()}-${filename}`, buf, { access: "public", contentType: mime });
        return res.status(200).json({ ok: true, imageUrl: blob.url, blob });
      }

      // 2) AIMusicAPI ops
      const key = getAimusicKey();
      const authHeaders: any = { "Authorization": `Bearer ${key}`, "Accept": "application/json" };

      if (op === "aimusicCredits") {
        const r = await aimusicRequest("/api/v1/get-credits", { method: "GET", headers: authHeaders });
        return res.status(r.ok ? 200 : 502).json(r);
      }

      if (op === "aimusicSunoCreate") {
        const payload = {
          task_type: "create_music",
          custom_mode: false,
          mv: "sonic-v4-5",
          gpt_description_prompt: asString(body.gpt_description_prompt || body.prompt || "")
        };
        const r = await aimusicRequest("/api/v1/sonic/create", {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        return res.status(r.ok ? 200 : 502).json(r);
      }

      if (op === "aimusicSunoTask") {
        const taskId = asString((req.query as any)?.taskId || "");
        if (!taskId) return res.status(400).json({ ok: false, error: "missing_taskId" });
        const r = await aimusicRequest(`/api/v1/sonic/task/${encodeURIComponent(taskId)}`, { method: "GET", headers: authHeaders });
        return res.status(r.ok ? 200 : 502).json(r);
      }

      // Udio mapped to Producer endpoints (AIMusic docs)
      if (op === "aimusicUdioCreate") {
        const payload = {
          task_type: "create_music",
          sound: asString(body.sound || body.prompt || ""),
          make_instrumental: body.make_instrumental ?? true,
          mv: asString(body.mv || "FUZZ-2.0")
        };
        const r = await aimusicRequest("/api/v1/producer/create", {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        return res.status(r.ok ? 200 : 502).json(r);
      }

      if (op === "aimusicUdioTask") {
        const taskId = asString((req.query as any)?.taskId || "");
        if (!taskId) return res.status(400).json({ ok: false, error: "missing_taskId" });
        const r = await aimusicRequest(`/api/v1/producer/task/${encodeURIComponent(taskId)}`, { method: "GET", headers: authHeaders });
        return res.status(r.ok ? 200 : 502).json(r);
      }

      return res.status(400).json({ ok: false, error: "unknown_op", op });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: "op_router_error", message: e?.message || String(e), op });
    }
  }

  function __getCookie(name: string) {
    const raw = String((req.headers as any)?.cookie || "");
    const m = raw.match(new RegExp("(?:^|; )" + name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&") + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  const __op = String((req.query as any)?.op || "");


  // Upload image to Vercel Blob and return a stable imageUrl
  if (__op === "blobPutImage") {
    const body = typeof req.body === "string" ? (safeJsonParse(req.body) || {}) : (req.body || {});
    const dataUrl = String(body.dataUrl || "");
    const filename = String(body.filename || "ref.png");

    if (!dataUrl.startsWith("data:")) {
      return res.status(400).json({ ok: false, error: "missing_data_url" });
    }

    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ ok: false, error: "invalid_data_url" });

    const mime = m[1];
    const b64 = m[2];
    const buf = Buffer.from(b64, "base64");

    if (buf.length === 0) return res.status(400).json({ ok: false, error: "empty_file" });
    if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ ok: false, error: "file_too_large", detail: "max 8MB" });

    // Requires BLOB_READ_WRITE_TOKEN to be set in Vercel env
    const blob = await put(`refs/${Date.now()}-${filename}` , buf, {
      access: "public",
      contentType: mime
    });

    return res.status(200).json({ ok: true, imageUrl: blob.url, blob });
  }
  if (__op === "redeemVeoProUpgrade") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const token = String(body.upgradeToken || "");
      const secret = process.env.JWT_SECRET || process.env.WORKFLOW_SECRET || "";
      if (!secret) return res.status(500).json({ ok: false, error: "missing JWT_SECRET" });

      const payload = verifyUpgradeToken(token, secret);
      if (!payload) return res.status(400).json({ ok: false, error: "invalid token" });

      const day = todayYYYYMMDD();
      if (payload.day !== day) return res.status(400).json({ ok: false, error: "token expired" });

      // Paid user gate (same MVP rule)
      const tier = String((req.headers as any)["x-user-tier"] || "").toLowerCase();
      const isPaidUser = tier === "paid" || tier === "pro";
      if (!isPaidUser) return res.status(403).json({ ok: false, error: "paid users only" });

      const usedCookie = __getCookie("veo_pro_upgrade_used_day");
      if (usedCookie === day) return res.status(429).json({ ok: false, error: "already used today" });

      // Set HttpOnly cookie, valid for 2 days just in case timezone drift; we check exact day value.
      res.setHeader("Set-Cookie", [
        `veo_pro_upgrade_used_day=${encodeURIComponent(day)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${2*24*60*60}`
      ]);

      return res.status(200).json({ ok: true, day, message: "升级券已领取：可去 Veo 3.1 Pro 生成一次（当天一次）" });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  }

  const __wfOp = String((req.query as any)?.op || "");
  /* WORKFLOW_ENGINE_V1 */
  // Workflow engine v1 (DB persistence to be added next iteration)
  if (__wfOp === "wfCreate") {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const type = String(body.type || "storyboardToVideo");
    const runId = newRunId();
    const now = nowIso();
    const state = createRunState(type as any, body.input || body);
    const run = {
      id: runId,
      userId: "dev-admin", // TODO: bind real user
      type,
      status: "running",
      inputJson: body.input || body,
      stateJson: state,
      outputsJson: {},
      createdAt: now,
      updatedAt: now,
    };
    return res.status(200).json({ ok: true, run });
  }

  if (__wfOp === "wfGet") {
    // v1: stateless demo. In next iteration, fetch from DB by runId.
    return res.status(501).json({ ok: false, error: "wfGet not implemented (DB pending)" });
  }

  if (__wfOp === "wfStep") {
    return res.status(501).json({ ok: false, error: "wfStep not implemented (connect providers pending)" });
  }


  /* AIMUSICAPI_PROXY_IN_JOBS */
  // Kling aliases on /api/jobs, routed to existing video pipeline
  if (__op === "klingCreate") {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const provider = String(body.provider || body.mode || (req.query as any)?.provider || (req.query as any)?.mode || "rapid");
    req.body = {
      ...body,
      type: "video",
      provider,
      prompt: body.prompt || body.text || "",
      imageUrl: body.imageUrl || body.image_url || body.firstFrameImageUrl || body.first_frame_image_url || "",
      aspectRatio: body.aspectRatio || body.aspect_ratio || "16:9",
      resolution: body.resolution || "720p",
      durationSeconds: body.durationSeconds || body.duration || 8,
    } as any;
    (req.query as any).type = "video";
    (req.query as any).provider = provider;
  }

  if (__op === "klingTask") {
    const provider = String((req.query as any)?.provider || (req.query as any)?.mode || "rapid");
    (req.query as any).type = "video";
    (req.query as any).provider = provider;
    (req.query as any).taskId = String((req.query as any)?.taskId || "");
  }

  // AIMusicAPI (Suno/Udio via AIMusicAPI) - keep within existing /api/jobs to avoid Vercel Hobby function limit.
  if (__op === "aimusicCredits") {
    const key = getAimusicKey();
    const r = await aimusicRequest("/api/v1/get-credits", { method: "GET", headers: { "Authorization": `Bearer ${key}`, "Accept": "application/json" } });
    return res.status(r.ok ? 200 : 502).json(({ ...r, issuedAt: Date.now() }) );
  }

  if (__op === "aimusicSunoCreate") {
    const key = getAimusicKey();
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const r = await aimusicRequest("/api/v1/sonic/create", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body),
    });
    
    const issuedAt = Number((req.query as any)?.issuedAt || 0);
    const elapsedMs = issuedAt ? Math.max(0, Date.now() - issuedAt) : 0;

    // Paid user gate: front-end must send X-User-Tier=paid|pro. (MVP; replace with server-verified plan later.)
    const tier = String((req.headers as any)["x-user-tier"] || "").toLowerCase();
    const isPaidUser = tier === "paid" || tier === "pro";

    const day = todayYYYYMMDD();
    const usedCookie = __getCookie("veo_pro_upgrade_used_day");
    const alreadyUsedToday = usedCookie === day;

    const queueTooLong = elapsedMs >= 90_000;

    let upgradeEligible = false;
    let upgradeToken: string | null = null;

    if (isPaidUser && queueTooLong && !alreadyUsedToday) {
      const secret = process.env.JWT_SECRET || process.env.WORKFLOW_SECRET || "";
      if (secret) {
        upgradeEligible = true;
        // sub is not strongly verified in MVP; we bind to tier only. Replace with real user id when auth is wired.
        upgradeToken = signUpgradeToken({ sub: "paid-user", day, reason: "kling_queue" }, secret);
      }
    }

    // Attach observability
    if (r && typeof r === "object") {
      (r as any).elapsedMs = elapsedMs;
      (r as any).queueTooLong = queueTooLong;
      (r as any).upgradeEligible = upgradeEligible;
      (r as any).upgradeToken = upgradeToken;
    }

    return res.status(r.ok ? 200 : 502).json(r);
  }

  if (__op === "aimusicSunoTask") {
    const key = getAimusicKey();
    const taskId = String((req.query as any)?.taskId || "");
    if (!taskId) return res.status(400).json({ ok: false, error: "missing taskId" });
    const r = await aimusicRequest(`/api/v1/sonic/task/${encodeURIComponent(taskId)}`, { method: "GET", headers: { "Authorization": `Bearer ${key}`, "Accept": "application/json" } });
    return res.status(r.ok ? 200 : 502).json(r);
  }


  // Udio (implemented via Producer API endpoints in AIMusicAPI docs)
  if (__op === "aimusicUdioCreate") {
    const key = getAimusicKey();
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    // Map a simple UI payload { prompt } into Producer schema
    const prompt = String(body.prompt || body.sound || body.gpt_description_prompt || "");
    const payload = {
      task_type: body.task_type || "create_music",
      sound: body.sound || prompt,
      lyrics: body.lyrics,
      make_instrumental: body.make_instrumental ?? true,
      mv: body.mv || "FUZZ-2.0",
      title: body.title,
      seed: body.seed,
      webhook_url: body.webhook_url,
      webhook_secret: body.webhook_secret,
    };
    const r = await aimusicRequest("/api/v1/producer/create", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return res.status(r.ok ? 200 : 502).json(r);
  }

  if (__op === "aimusicUdioTask") {
    const key = getAimusicKey();
    const taskId = String((req.query as any)?.taskId || "");
    if (!taskId) return res.status(400).json({ ok: false, error: "missing taskId" });
    const r = await aimusicRequest(`/api/v1/producer/task/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Accept": "application/json",
      },
    });
    return res.status(r.ok ? 200 : 502).json(r);
  }
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
      let imageMimeType = "image/png";
      for (const p of parts) {
        if (p?.inlineData?.data) {
          base64img = p.inlineData.data;
          imageMimeType = asString(p?.inlineData?.mimeType || "image/png") || "image/png";
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
        imageMimeType,
        imageUrl: `data:${imageMimeType};base64,${base64img}`,
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
        const operationName = normalizePredictOperationName(taskId, projectId, location, model);
        const statusUrl = `${baseUrl}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:fetchPredictOperation`;
        const statusResp = await fetch(statusUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ operationName }),
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

      const operationName = normalizeOperationName(asString(raw?.name), projectId, location);
      const operationId = operationName.split("/").pop() || "";

      return res.status(200).json({
        ok: true,
        taskId: normalizePredictOperationName(asString(raw?.name), projectId, location, model),
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
