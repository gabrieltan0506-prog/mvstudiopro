import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

const DEFAULT_PROMPT =
  "A woman in red evening dress walks indoors, gradually transforms into ski outfit with reflective goggles, opens the door into heavy snowstorm. cinematic, realistic, continuous shot.";

const DEFAULT_DURATION = "8" as const;
const DEFAULT_ASPECT_RATIO = "16:9" as const;
const DEFAULT_BASE_URL = "https://api-beijing.klingai.com";

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function base64UrlEncode(data: Buffer): string {
  return data.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function createKlingJwt(accessKey: string, secretKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: accessKey,
    exp: now + 1800,
    nbf: now - 5,
    iat: now,
  };

  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(signingInput)
    .digest();

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function normalizeDuration(input: unknown): "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "15" {
  const value = String(input ?? DEFAULT_DURATION).trim();
  const allowed = new Set(["3", "4", "5", "6", "7", "8", "9", "10", "15"]);
  return allowed.has(value) ? (value as "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "15") : DEFAULT_DURATION;
}

function normalizeAspectRatio(input: unknown): "16:9" | "9:16" | "1:1" {
  const value = String(input ?? DEFAULT_ASPECT_RATIO).trim();
  if (value === "9:16" || value === "1:1") return value;
  return "16:9";
}

function parsePostBody(req: VercelRequest): { prompt?: string; duration?: unknown; aspectRatio?: unknown } {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  if (req.body && typeof req.body === "object") {
    return req.body as { prompt?: string; duration?: unknown; aspectRatio?: unknown };
  }

  return {};
}

function shouldPing(req: VercelRequest): boolean {
  const ping = req.query.ping;
  if (Array.isArray(ping)) return ping.includes("1");
  return ping === "1";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).setHeader("Allow", "GET, POST").json({ ok: false, error: "Method Not Allowed" });
  }

  const accessKey = process.env.KLING_CN_VIDEO_ACCESS_KEY?.trim();
  const secretKey = process.env.KLING_CN_VIDEO_SECRET_KEY?.trim();
  const baseUrl = (process.env.KLING_CN_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");

  if (!hasValue(accessKey) || !hasValue(secretKey)) {
    return res.status(400).json({ ok: false, error: "Missing KLING_CN_VIDEO_ACCESS_KEY/SECRET_KEY" });
  }

  if (shouldPing(req)) {
    return res.status(200).json({ ok: true, configured: true, provider: "kling_beijing", baseUrl });
  }

  const body = req.method === "POST" ? parsePostBody(req) : {};
  const prompt = (body.prompt && String(body.prompt).trim()) || DEFAULT_PROMPT;
  const duration = normalizeDuration(body.duration);
  const aspectRatio = normalizeAspectRatio(body.aspectRatio);

  const token = createKlingJwt(accessKey, secretKey);
  const url = `${baseUrl}/v1/videos/omni-video`;
  const upstreamResponse = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model_name: "kling-v3-omni",
      prompt,
      duration,
      aspect_ratio: aspectRatio,
      mode: "std",
    }),
  });

  const responseText = await upstreamResponse.text();
  const responsePreview = responseText.slice(0, 1000);

  let parsed: any = null;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    parsed = null;
  }

  if (!upstreamResponse.ok) {
    return res.status(upstreamResponse.status).json({
      ok: false,
      provider: "kling_beijing",
      status: upstreamResponse.status,
      error: "Upstream request failed",
      upstream: responsePreview,
    });
  }

  const taskId = parsed?.data?.task_id ?? parsed?.task_id ?? null;

  return res.status(200).json({
    ok: true,
    provider: "kling_beijing",
    taskId,
    status: upstreamResponse.status,
    raw: parsed,
    response: responsePreview,
  });
}
