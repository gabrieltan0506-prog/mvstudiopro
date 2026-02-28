import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { getVideoUrlByTaskId } from "./_core/video-short-links";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const rawTaskId = req.query.taskId;
  const taskId = (Array.isArray(rawTaskId) ? rawTaskId[0] : rawTaskId ?? "").toString().trim();
  if (!taskId) {
    return res.status(404).json({ ok: false, error: "not found" });
  }

  const videoUrl = await getVideoUrlByTaskId(taskId);
  if (videoUrl) {
    return res.redirect(302, videoUrl);
  }

  const accessKey = process.env.KLING_CN_VIDEO_ACCESS_KEY?.trim();
  const secretKey = process.env.KLING_CN_VIDEO_SECRET_KEY?.trim();
  if (!accessKey || !secretKey) {
    return res.status(404).json({ ok: false, error: "not found" });
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
    const parsed = (await upstream.json().catch(() => ({}))) as any;
    const upstreamVideoUrl =
      parsed?.data?.task_result?.videos?.[0]?.url ??
      parsed?.task_result?.videos?.[0]?.url ??
      null;
    if (!upstreamVideoUrl || typeof upstreamVideoUrl !== "string") {
      return res.status(404).json({ ok: false, error: "not found" });
    }
    return res.redirect(302, upstreamVideoUrl);
  } catch {
    return res.status(404).json({ ok: false, error: "not found" });
  }
}
