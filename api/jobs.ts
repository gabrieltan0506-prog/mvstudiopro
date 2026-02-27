import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    return res.status(200).json({
      status: "ok",
      message: "jobs endpoint reachable"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "string"
    ? (() => {
        try {
          return JSON.parse(req.body) as Record<string, unknown>;
        } catch {
          return {} as Record<string, unknown>;
        }
      })()
    : ((req.body as Record<string, unknown>) ?? {});

  const provider = String(body.provider ?? "");
  if (provider !== "kling_beijing") {
    return res.status(400).json({ ok: false, error: "Unsupported provider" });
  }

  const accessKey = process.env.KLING_CN_VIDEO_ACCESS_KEY?.trim();
  const secretKey = process.env.KLING_CN_VIDEO_SECRET_KEY?.trim();
  const baseUrl = (process.env.KLING_CN_BASE_URL?.trim() || "https://api-beijing.klingai.com").replace(/\/$/, "");

  if (!accessKey || !secretKey) {
    return res.status(400).json({ ok: false, error: "Missing KLING_CN_VIDEO_ACCESS_KEY/SECRET_KEY" });
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { iss: accessKey, exp: now + 1800, nbf: now - 5, iat: now };
  const toBase64Url = (value: Buffer) =>
    value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const headerB64 = toBase64Url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = toBase64Url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = crypto.createHmac("sha256", secretKey).update(signingInput).digest();
  const token = `${signingInput}.${toBase64Url(signature)}`;

  const prompt = String(body.prompt ?? "");
  const duration = String(body.duration ?? "8");
  const aspectRatio = String(body.aspectRatio ?? "16:9");
  if (!prompt.trim()) {
    return res.status(400).json({ ok: false, error: "Missing prompt" });
  }

  try {
    const upstream = await fetch(`${baseUrl}/v1/videos/omni-video`, {
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
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text.slice(0, 1000) };
    }

    const taskId = parsed?.data?.task_id ?? parsed?.task_id ?? null;
    return res.status(upstream.status).json({
      ok: upstream.ok,
      provider: "kling_beijing",
      task_id: taskId,
      raw: parsed,
    });
  } catch (error: any) {
    return res.status(502).json({
      ok: false,
      provider: "kling_beijing",
      error: error?.message || "Upstream request failed",
    });
  }
}
