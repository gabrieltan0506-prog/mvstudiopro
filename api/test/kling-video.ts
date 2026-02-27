import crypto from "crypto";
import fetch from "node-fetch";

const DEFAULT_BASE_URL = "https://api-beijing.klingai.com";
const DEFAULT_PROMPT =
  "A woman in red evening dress walks indoors, gradually transforms into ski outfit with reflective goggles, opens the door into heavy snowstorm. cinematic, realistic, continuous shot.";

function base64UrlEncode(data: Buffer): string {
  return data.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function createJwt(accessKey: string, secretKey: string): string {
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
  const signature = crypto.createHmac("sha256", secretKey).update(signingInput).digest();

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function parseJsonBody(body: unknown): Record<string, unknown> {
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (body && typeof body === "object") {
    return body as Record<string, unknown>;
  }
  return {};
}

export default async function handler(req: any, res: any) {
  const ACCESS = process.env.KLING_CN_VIDEO_ACCESS_KEY;
  const SECRET = process.env.KLING_CN_VIDEO_SECRET_KEY;
  const BASE = (process.env.KLING_CN_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");

  if (!ACCESS || !SECRET) {
    return res.status(400).json({ ok: false, error: "Missing KLING_CN_VIDEO_ACCESS_KEY/SECRET_KEY" });
  }

  if (req.method === "GET" && String(req.query?.ping || "") === "1") {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).setHeader("Allow", "GET, POST").json({ ok: false, error: "Method Not Allowed" });
  }

  const body = parseJsonBody(req.body);
  const prompt = String(body.prompt || DEFAULT_PROMPT);
  const duration = String(body.duration || "8");
  const aspectRatio = String(body.aspectRatio || "16:9");

  const token = createJwt(ACCESS, SECRET);
  const upstream = await fetch(`${BASE}/v1/videos/omni-video`, {
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

  const text = await upstream.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 1000) };
  }

  return res.status(upstream.status).json(parsed);
}
