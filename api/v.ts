import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getVideoUrlByTaskId } from "../server/services/video-short-links";

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
  if (!videoUrl) {
    return res.status(404).json({ ok: false, error: "not found" });
  }

  return res.redirect(302, videoUrl);
}
