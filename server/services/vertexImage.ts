/**
 * Imagen 4.0 高清放大：2x / 4x 统一走 GCS 落地 + 轮询 + Signed URL。
 * 不向客户端回传 data:base64，避免 Vercel 4.5MB 与 OOM；Fly 上直接跑，避免代理超时不足。
 */
import crypto from "node:crypto";
import { put } from "@vercel/blob";

function s(v: unknown) {
  if (v == null) return "";
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}
function jparse(t: string) {
  try {
    return JSON.parse(t) as any;
  } catch {
    return null;
  }
}

async function getVertexAccessToken(): Promise<string> {
  const raw = s(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON).trim();
  if (!raw) throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS_JSON");
  const sa: any = jparse(raw);
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
  if (!tokenRes.ok || !json?.access_token) throw new Error("Vertex token failed: " + JSON.stringify(json));
  return json.access_token;
}

function baseUrlFor(location: string) {
  return location === "global" ? "https://aiplatform.googleapis.com" : `https://${location}-aiplatform.googleapis.com`;
}

async function downloadFromGcs(gsUri: string, accessToken: string): Promise<Buffer> {
  const withoutScheme = gsUri.replace(/^gs:\/\//, "");
  const slashIdx = withoutScheme.indexOf("/");
  const bucket = withoutScheme.slice(0, slashIdx);
  const object = encodeURIComponent(withoutScheme.slice(slashIdx + 1));
  const url = `https://storage.googleapis.com/download/storage/v1/b/${bucket}/o/${object}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`GCS download failed: ${res.status} ${await res.text().catch(() => "")}`);
  return Buffer.from(await res.arrayBuffer());
}

async function signGcsUrl(gsUri: string, sa: { client_email: string; private_key: string }): Promise<string> {
  const withoutScheme = gsUri.replace(/^gs:\/\//, "");
  const slashIdx = withoutScheme.indexOf("/");
  const bucket = withoutScheme.slice(0, slashIdx);
  const objectPath = withoutScheme.slice(slashIdx + 1);
  const encodedObject = objectPath.split("/").map(encodeURIComponent).join("/");
  const expiry = 3600;
  const now = Math.floor(Date.now() / 1000);
  const dateIso = new Date(now * 1000).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const datePart = dateIso.slice(0, 8);
  const credentialScope = `${datePart}/auto/storage/goog4_request`;
  const credential = `${sa.client_email}/${credentialScope}`;
  const headers = `host:storage.googleapis.com\n`;
  const signedHeaders = "host";
  const canonicalRequest = [
    "GET",
    `/${bucket}/${encodedObject}`,
    `X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=${encodeURIComponent(credential)}&X-Goog-Date=${dateIso}&X-Goog-Expires=${expiry}&X-Goog-SignedHeaders=${signedHeaders}`,
    headers,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const hash = crypto.createHash("sha256").update(canonicalRequest).digest("hex");
  const stringToSign = `GOOG4-RSA-SHA256\n${dateIso}\n${credentialScope}\n${hash}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(stringToSign);
  sign.end();
  const signature = sign.sign(sa.private_key).toString("hex");
  return `https://storage.googleapis.com/${bucket}/${encodedObject}?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=${encodeURIComponent(credential)}&X-Goog-Date=${dateIso}&X-Goog-Expires=${expiry}&X-Goog-SignedHeaders=${signedHeaders}&X-Goog-Signature=${signature}`;
}

/** 轮询 GCS 对象已存在，默认 300s */
async function waitForGcsFile(gsUri: string, accessToken: string, maxWaitMs = 300_000): Promise<boolean> {
  const withoutScheme = gsUri.replace(/^gs:\/\//, "");
  const slashIdx = withoutScheme.indexOf("/");
  const bucket = withoutScheme.slice(0, slashIdx);
  const object = encodeURIComponent(withoutScheme.slice(slashIdx + 1));
  const metaUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${object}`;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(metaUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

function extractImagesFromPredict(raw: any): Array<{ data: string; mimeType: string }> {
  const images: Array<{ data: string; mimeType: string }> = [];
  const predictions = Array.isArray(raw?.predictions) ? raw.predictions : [];
  for (const item of predictions) {
    const data = s(item?.bytesBase64Encoded || item?.image?.bytesBase64Encoded || item?.b64Json).trim();
    if (data) {
      images.push({ data, mimeType: s(item?.mimeType || item?.image?.mimeType || "image/png").trim() || "image/png" });
    }
  }
  return images;
}

async function fetchJson(url: string, init: RequestInit) {
  const r = await fetch(url, init);
  const t = await r.text();
  const j = jparse(t);
  return { ok: r.ok, status: r.status, url, json: j, rawText: t.slice(0, 4000) };
}

function shouldRetryVertexImage(status: number, json: any, rawText: string) {
  const message = String(json?.error?.status || json?.error?.message || rawText || "").toUpperCase();
  return status === 429 || message.includes("RESOURCE_EXHAUSTED");
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchImageAsBase64(imageUrl: string) {
  const url = s(imageUrl).trim();
  if (!url) throw new Error("missing_image_url");
  const dataMatch = url.match(/^data:([^;,]+);base64,(.+)$/);
  if (dataMatch?.[1] && dataMatch?.[2]) {
    const mimeType = String(dataMatch[1] || "image/png");
    const b64 = String(dataMatch[2] || "").trim();
    const buf = Buffer.from(b64, "base64");
    if (!buf.length) throw new Error("empty_image");
    if (buf.length > 10 * 1024 * 1024) throw new Error("image_too_large");
    return { mimeType, b64, bytes: buf.length };
  }
  const token = s(process.env.BLOB_READ_WRITE_TOKEN).trim();
  const headers: Record<string, string> = { "User-Agent": "mvstudiopro/1.0 (+google-fetch)" };
  let r = await fetch(url, { redirect: "follow", headers });
  if (r.status === 403 && token) {
    headers["Authorization"] = `Bearer ${token}`;
    r = await fetch(url, { redirect: "follow", headers });
  }
  if (!r.ok) throw new Error("image_fetch_failed:" + r.status);
  const mimeType = String(r.headers.get("content-type") || "image/png");
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error("empty_image");
  if (buf.length > 10 * 1024 * 1024) throw new Error("image_too_large");
  return { mimeType, b64: buf.toString("base64"), bytes: buf.length };
}

export type VertexUpscaleResult = {
  ok: boolean;
  status?: number;
  url?: string;
  raw?: any;
  imageUrl?: string;
  imageUrls?: string[];
  imageCount?: number;
  upscaleFactor?: string;
  error?: string;
};

/**
 * 2x/4x 统一：先写 GCS 目标（output 前缀 + 稳定文件名）→ 轮询 → Signed URL；失败则内联上 Blob 仍仅返回 http(s) URL。
 */
export async function runVertexUpscaleImage(args: {
  imageUrl: string;
  prompt?: string;
  upscaleFactor: "x2" | "x3" | "x4";
  outputMimeType?: string;
}): Promise<VertexUpscaleResult> {
  const projectId = s(process.env.VERTEX_PROJECT_ID).trim();
  if (!projectId) return { ok: false, error: "missing_VERTEX_PROJECT_ID" };
  let token: string;
  try {
    token = await getVertexAccessToken();
  } catch (e: any) {
    return { ok: false, error: e?.message || "vertex_token_failed" };
  }
  const sa: any = jparse(s(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON).trim());
  if (!sa?.client_email || !sa?.private_key) return { ok: false, error: "invalid_SA_JSON" };

  const imageUrl = s(args.imageUrl);
  if (!imageUrl) return { ok: false, error: "missing_image_url" };
  const prompt = s(args.prompt);
  const outputMimeType = s(args.outputMimeType || "image/png").trim() || "image/png";
  const requestedFactor = s(args.upscaleFactor || "x2").toLowerCase();
  const upscaleFactor = requestedFactor === "x4" ? "x4" : requestedFactor === "x3" ? "x3" : "x2";
  const location = (s(process.env.VERTEX_IMAGE_LOCATION_UPSCALE || process.env.VERTEX_IMAGE_LOCATION) || "global").trim();
  const model = (s(process.env.VERTEX_IMAGE_MODEL_UPSCALE) || "imagen-4.0-upscale-preview").trim();
  const base = baseUrlFor(location);
  const predictUrl = `${base}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;

  let img: { mimeType: string; b64: string; bytes: number };
  try {
    img = await fetchImageAsBase64(imageUrl);
  } catch (e: any) {
    return { ok: false, error: e?.message || "image_fetch_failed" };
  }

  const outputFolder = `upscaled/${Date.now()}/`;
  const outputUriPrefix = `gs://mv-studio-pro-vertex-video-temp/${outputFolder}`;
  const gcsOutputUri = `${outputUriPrefix}imagen-upscaled-${upscaleFactor}.png`;

  const requestInit: RequestInit = {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt, image: { bytesBase64Encoded: img.b64 } }],
      parameters: {
        sampleCount: 1,
        mode: "upscale",
        outputOptions: { mimeType: outputMimeType },
        upscaleConfig: { upscaleFactor },
        storageUri: gcsOutputUri,
      },
    }),
  };

  let r = await fetchJson(predictUrl, requestInit);
  for (let attempt = 0; attempt < 4 && shouldRetryVertexImage(r.status, r.json, r.rawText); attempt += 1) {
    await sleep(2 ** attempt * 1000 + Math.floor(Math.random() * 300));
    r = await fetchJson(predictUrl, requestInit);
  }
  const raw = r.json ?? r.rawText;
  if (!r.ok) {
    const errMsg = r.json?.error?.message || r.json?.error?.status || r.rawText || `HTTP ${r.status}`;
    console.error(`[vertexImage] upscale ${upscaleFactor} failed: ${errMsg}`);
    return { ok: false, status: r.status, url: r.url, raw, error: errMsg, imageUrl: "", imageUrls: [], imageCount: 0, upscaleFactor };
  }

  const preds: any[] = r.json?.predictions || [];
  const gcsUriFromResponse = preds.map((p: any) => s(p.gcsUri || p.outputUri || p.uri || "")).find(Boolean);
  const finalGcsUri = gcsUriFromResponse || gcsOutputUri;
  console.log(`[vertexImage] ${upscaleFactor} GCS target: ${finalGcsUri}`);

  const fileReady = await waitForGcsFile(finalGcsUri, token, 300_000);
  if (fileReady) {
    try {
      const signed = await signGcsUrl(finalGcsUri, sa);
      return { ok: true, status: 200, url: predictUrl, raw, imageUrl: signed, imageUrls: [signed], imageCount: 1, upscaleFactor };
    } catch (e: any) {
      console.error(`[vertexImage] signGcsUrl failed, try blob via GCS read:`, e?.message);
    }
    try {
      const buf = await downloadFromGcs(finalGcsUri, token);
      const blob = await put(`upscaled-${upscaleFactor}-${Date.now()}.png`, buf, { access: "public", contentType: "image/png" });
      return { ok: true, status: 200, url: predictUrl, raw, imageUrl: blob.url, imageUrls: [blob.url], imageCount: 1, upscaleFactor };
    } catch (e: any) {
      console.error(`[vertexImage] GCS→Blob failed:`, e?.message);
    }
  }

  const images = extractImagesFromPredict(r.json);
  if (images.length === 0) {
    return { ok: false, status: 500, url: predictUrl, raw, error: "no_image_in_response", imageUrl: "", imageUrls: [], imageCount: 0, upscaleFactor };
  }
  const out: string[] = [];
  for (const item of images) {
    const buf = Buffer.from(item.data, "base64");
    const blob = await put(`upscaled-${upscaleFactor}-${Date.now()}.png`, buf, { access: "public", contentType: item.mimeType || "image/png" });
    out.push(blob.url);
  }
  return { ok: true, status: 200, url: predictUrl, raw, imageUrl: out[0], imageUrls: out, imageCount: out.length, upscaleFactor };
}
