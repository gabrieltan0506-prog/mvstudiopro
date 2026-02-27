import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

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

function resolveTaskId(req: VercelRequest): string | null {
  const fromTaskId = req.query.taskId;
  const fromTaskIdSnake = req.query.task_id;

  const value = Array.isArray(fromTaskId)
    ? fromTaskId[0]
    : Array.isArray(fromTaskIdSnake)
    ? fromTaskIdSnake[0]
    : fromTaskId ?? fromTaskIdSnake;

  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value.trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).setHeader("Allow", "GET").json({ ok: false, error: "Method Not Allowed" });
  }

  const accessKey = process.env.KLING_CN_VIDEO_ACCESS_KEY?.trim();
  const secretKey = process.env.KLING_CN_VIDEO_SECRET_KEY?.trim();
  if (!hasValue(accessKey) || !hasValue(secretKey)) {
    return res.status(400).json({ ok: false, error: "Missing KLING_CN_VIDEO_ACCESS_KEY/SECRET_KEY" });
  }

  const taskId = resolveTaskId(req);
  if (!taskId) {
    return res.status(400).json({ ok: false, error: "Missing task_id" });
  }

  const token = createKlingJwt(accessKey, secretKey);
  const baseUrl = (process.env.KLING_CN_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const url = `${baseUrl}/v1/videos/omni-video?task_id=${encodeURIComponent(taskId)}`;

  const upstreamResponse = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const responseText = await upstreamResponse.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    parsed = { response: responseText.slice(0, 1000) };
  }

  return res.status(upstreamResponse.status).json({
    ok: upstreamResponse.ok,
    taskId,
    raw: parsed,
  });
}
