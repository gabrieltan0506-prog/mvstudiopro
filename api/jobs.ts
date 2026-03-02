import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getVertexAccessToken } from "./vertex.js";

/**
 * 圖片生成 endpoint，只支持 type=image
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const type     = String(req.query?.type || "");
    const prompt   = String(req.query?.prompt || "");
    const provider = String(req.query?.provider || "nano-banana-flash");

    if (!type && !prompt) {
      return res.status(200).json({ ok: true, message: "jobs endpoint reachable" });
    }
    if (type !== "image") {
      return res.status(400).json({ ok: false, error: "unsupported_type", type });
    }
    if (!prompt) {
      return res.status(400).json({ ok: false, error: "missing_prompt" });
    }

    const model =
      provider === "nano-banana-pro"
        ? process.env.VERTEX_IMAGE_MODEL_PRO
        : process.env.VERTEX_IMAGE_MODEL_FLASH;

    const projectId = String(process.env.VERTEX_PROJECT_ID || "");
    const location  = String(process.env.VERTEX_LOCATION || "global");

    const token   = await getVertexAccessToken();
    const baseUrl = location === "global"
      ? "https://aiplatform.googleapis.com"
      : `https://${location}-aiplatform.googleapis.com`;

    const url  = `${baseUrl}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
    const body = {
      contents: [
        { role: "user", parts: [{ text: prompt }] }
      ],
      generationConfig: {
        responseMimeType: "image/png"
      }
    };

    const r    = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        type: "image",
        provider,
        error: "image_generation_failed",
        detail: json
      });
    }

    const parts = json?.candidates?.[0]?.content?.parts || [];
    let base64img = null;
    for (const p of parts) {
      if (p?.inlineData?.data) {
        base64img = p.inlineData.data;
        break;
      }
    }
    if (!base64img) {
      return res.status(500).json({
        ok: false,
        type: "image",
        provider,
        error: "no_image_in_response",
        detail: json
      });
    }

    return res.status(200).json({
      ok: true,
      type: "image",
      provider,
      imageUrl: `data:image/png;base64,${base64img}`
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: (e as any)?.message,
      stack: (e as any)?.stack
    });
  }
}
