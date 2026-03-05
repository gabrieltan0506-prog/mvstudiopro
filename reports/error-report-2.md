
# MVStudioPro Error Report 2

Generated: 2026-03-05T14:37:22.364Z

## Repository
```
origin	https://***@github.com/gabrieltan0506-prog/mvstudiopro.git (fetch)
origin	https://***@github.com/gabrieltan0506-prog/mvstudiopro.git (push)
```

## Branch
reports/error-report-2

## Commit
bcb865dc45672d651bcd0569d56a672a673665ee

## API Directory
```
_core
admin
auth
blob
blob-put-image.ts
diag
jobs.ts
utils
v
vertex.ts.bak
```

## api/jobs.ts (head)
```ts
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
```

## RemixStudio video player check
```
23:  const [videoUrl, setVideoUrl] = useState<string>("");
86:          pj?.json?.videoUrl ||
137:      {videoUrl ? (
140:          <video controls src={videoUrl} style={{ width: "100%", borderRadius: 12, background: "black" }} />
143:              href={videoUrl}
```

## Endpoint diagnostics

### blobPutImage
```
A server error has occurred

FUNCTION_INVOCATION_FAILED

sfo1::27gnd-1772721445785-e67be3c5c19c
```

### sunoCreate
```
A server error has occurred

FUNCTION_INVOCATION_FAILED

sfo1::p5x55-1772721447948-2d0d461ccfc2
```

### udioCreate
```
A server error has occurred

FUNCTION_INVOCATION_FAILED

sfo1::8pjkd-1772721449516-0e7e1bff1c40
```

### klingCreate
```
A server error has occurred

FUNCTION_INVOCATION_FAILED

sfo1::cpfb6-1772721451297-d5f8ca64727a
```

## Known Issues

- Udio endpoint incomplete
- Veo upload path instability
- RemixStudio videoUrl runtime error
- jobs.ts syntax instability history

## Goal

Stabilize production AI Studio pipeline:
Kling / Suno / Udio / Veo / Gemini / Nano Banana
