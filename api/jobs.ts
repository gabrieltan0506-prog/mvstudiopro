import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateGeminiImage } from "../server/gemini-image.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const body = req.body || {};
    const type = body.type || req.query?.type;

    // 强制 image 默认走 nano-banana-flash
    if (type === "image") {
      
    const prompt = (body?.input?.prompt ?? body?.prompt ?? "").toString();
    // IMAGE_GEN_TRY_CATCH
    try {
    const out = await generateGeminiImage({
      prompt,
      quality: "1k",
      // 兼容：后端内部会用你配置的 Vertex/Gemini key
    } as any);

    // 兼容多种返回结构
    const imageUrl =
      (out as any)?.imageUrl ||
      (out as any)?.url ||
      (out as any)?.images?.[0]?.url ||
      (out as any)?.data?.[0]?.url ||
      null;

    return res.status(200).json({
      ok: true,
      provider,
      imageUrl,
      raw: out,
      debug: { receivedProvider: body?.provider ?? req.query?.provider ?? null }
    });

    } catch (e: any) {
      return res.status(200).json({
        ok: false,
        provider,
        error: "image_generation_failed",
        detail: String(e?.message || e),
        stack: (e?.stack ? String(e.stack).slice(0, 2000) : undefined),
        hint: "Check Vercel Function Logs and required Google/Gemini env vars"
      });
    }
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
