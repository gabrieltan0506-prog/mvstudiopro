import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

function json(res: VercelResponse, status: number, data: any) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function buildJwt(ak: string, sk: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: ak, exp: now + 1800, nbf: now - 5 })).toString("base64url");
  const msg = `${header}.${payload}`;
  const sig = crypto.createHmac("sha256", sk).update(msg).digest("base64url");
  return `${msg}.${sig}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = (req.body || {}) as any;
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return json(res, 400, { ok: false, error: "missing_prompt" });

    const baseUrl = process.env.KLING_CN_BASE_URL || "https://api-beijing.klingai.com";
    const accessKey = process.env.KLING_CN_IMAGE_ACCESS_KEY || process.env.KLING_CN_VIDEO_ACCESS_KEY || "";
    const secretKey = process.env.KLING_CN_IMAGE_SECRET_KEY || process.env.KLING_CN_VIDEO_SECRET_KEY || "";

    if (!accessKey || !secretKey) {
      return json(res, 500, { ok: false, error: "missing_kling_env" });
    }

    const token = buildJwt(accessKey, secretKey);
    const upstream = await fetch(`${baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: body.model || body.model_name || "kling-2.6",
        prompt,
        resolution: body.resolution || "1024x1024",
      }),
    });

    const text = await upstream.text();
    let payload: any = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }

    return json(res, upstream.ok ? 200 : upstream.status, payload);
  } catch (e: any) {
    return json(res, 500, { ok: false, error: "server_error", detail: String(e?.message || e) });
  }
}
