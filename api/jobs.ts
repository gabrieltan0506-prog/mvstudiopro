import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { saveVideoShortLink } from "../server/services/video-short-links";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const body = typeof req.body === "string"
    ? (() => {
        try {
          return JSON.parse(req.body) as Record<string, unknown>;
        } catch {
          return {} as Record<string, unknown>;
        }
      })()
    : ((req.body as Record<string, unknown>) ?? {});

  const input = (body.input && typeof body.input === "object") ? (body.input as Record<string, unknown>) : null;
  const params = (input?.params && typeof input.params === "object") ? (input.params as Record<string, unknown>) : null;
  const action = String(input?.action ?? body?.action ?? "");
  const inferredProvider = action === "omni_t2v" || action === "omni_i2v" || action === "omni_storyboard"
    ? "kling_beijing"
    : "";
  const provider = (req.query.provider ?? body?.provider ?? input?.provider ?? inferredProvider ?? "").toString();
  const taskIdQuery = req.query.task_id;
  const taskId = (Array.isArray(taskIdQuery) ? taskIdQuery[0] : taskIdQuery ?? "").toString().trim();

  if (req.method === "GET" && taskId) {
    const accessKey = process.env.KLING_CN_VIDEO_ACCESS_KEY?.trim();
    const secretKey = process.env.KLING_CN_VIDEO_SECRET_KEY?.trim();
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

    try {
      const upstream = await fetch(`https://api-beijing.klingai.com/v1/videos/omni-video?task_id=${encodeURIComponent(taskId)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const text = await upstream.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text.slice(0, 1000) };
      }

      const status = parsed?.data?.task_status ?? parsed?.task_status;
      const videoUrl =
        parsed?.data?.task_result?.videos?.[0]?.url ??
        parsed?.task_result?.videos?.[0]?.url ??
        null;

      if (status === "succeed" && typeof videoUrl === "string" && videoUrl.trim()) {
        await saveVideoShortLink(taskId, videoUrl);
        return res.status(200).json({
          ok: true,
          taskId,
          status,
          videoUrl,
          shortUrl: `/v/${encodeURIComponent(taskId)}`,
          raw: parsed,
        });
      }

      return res.status(200).json({
        ok: upstream.ok,
        taskId,
        status: status ?? "unknown",
        raw: parsed,
      });
    } catch (error: any) {
      return res.status(502).json({ ok: false, error: error?.message || "Upstream request failed" });
    }
  }

  if (req.method === "GET" && (provider === "kling_beijing" || provider === "kling")) {
    const accessKey = process.env.KLING_CN_VIDEO_ACCESS_KEY?.trim();
    const secretKey = process.env.KLING_CN_VIDEO_SECRET_KEY?.trim();
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

    try {
      const upstream = await fetch("https://api-beijing.klingai.com/v1/videos/omni-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model_name: "kling-v3-omni",
          prompt: "A woman in red evening dress walks indoors and transforms into ski outfit in heavy snow",
          duration: "8",
          aspect_ratio: "16:9",
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
        ok: true,
        taskId,
        raw: parsed,
      });
    } catch (error: any) {
      return res.status(502).json({ ok: false, error: error?.message || "Upstream request failed" });
    }
  }

  if (req.method === "GET") {
    return res.status(200).json({
      status: "ok",
      message: "jobs endpoint reachable"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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

  const prompt = String(body.prompt ?? params?.prompt ?? "");
  const duration = String(body.duration ?? params?.duration ?? "8");
  const aspectRatio = String(body.aspectRatio ?? params?.aspectRatio ?? "16:9");
  const referenceImage = body.reference_image ?? params?.reference_image;
  const faceConsistency = body.face_consistency ?? params?.face_consistency;
  const identityStrength = body.identity_strength ?? params?.identity_strength;
  const transformationMode = body.transformation_mode ?? params?.transformation_mode;
  if (!prompt.trim()) {
    return res.status(400).json({ ok: false, error: "Missing prompt" });
  }

  const requestBody: Record<string, unknown> = {
    model_name: "kling-v3-omni",
    prompt,
    duration,
    aspect_ratio: aspectRatio,
    mode: "std",
  };
  if (referenceImage != null && String(referenceImage).trim()) {
    requestBody.reference_image = String(referenceImage).trim();
  }
  if (faceConsistency === true || faceConsistency === "true") {
    requestBody.face_consistency = true;
  }
  if (identityStrength != null && String(identityStrength).trim() !== "") {
    const strength = Number(identityStrength);
    if (Number.isFinite(strength)) {
      requestBody.identity_strength = strength;
    }
  }
  if (transformationMode != null && String(transformationMode).trim()) {
    requestBody.transformation_mode = String(transformationMode).trim();
  }

  try {
    const upstream = await fetch(`${baseUrl}/v1/videos/omni-video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
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
