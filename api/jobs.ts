import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const body = req.body || {};
    const type = body.type || req.query?.type;

    // 强制 image 默认走 nano-banana-flash
    if (type === "image") {
      return res.status(200).json({
        ok: true,
        provider: "nano-banana-flash",
        message: "image provider resolved",
        debug: {
          receivedProvider: body.provider || req.query?.provider || null
        }
      });
    }

    // 视频保持原逻辑（kling_beijing）
    if (type === "video") {
      return res.status(200).json({
        ok: true,
        provider: "kling_beijing",
        message: "video provider ok"
      });
    }

    return res.status(400).json({
      ok: false,
      error: "Invalid type"
    });

  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: "Server error",
      detail: e?.message || "unknown"
    });
  }
}
