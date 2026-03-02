import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    return res.status(200).json({
      status: "ok",
      message: "jobs endpoint reachable"
    });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

// === GEMINI IMAGE GENERATION BRANCH ===
if (req.method === "GET" && (req.query?.type === "image" || req.query?.prompt)) {
  try {
    const prompt = String(req.query?.prompt || req.body?.prompt || "");
    if (!prompt) {
      return res.status(400).json({ ok: false, error: "missing_prompt" });
    }

    const model =
      provider === "nano-banana-pro"
        ? process.env.VERTEX_IMAGE_MODEL_PRO
        : process.env.VERTEX_IMAGE_MODEL_FLASH;

    const projectId = String(process.env.VERTEX_PROJECT_ID || "");
    const location  = String(process.env.VERTEX_LOCATION || "");

    // Vertex Gemini Image generateContent
    const token = await getVertexAccessToken();
    const baseUrl = location === "global"
      ? "https://aiplatform.googleapis.com"
      : `https://${location}-aiplatform.googleapis.com`;

    const url = `${baseUrl}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

    const body = {
      contents: [
        { role: "user", parts: [{ text: prompt }] }
      ],
      generationConfig: {
        responseMimeType: "image/png"
      }
    };

    const r = await fetch(url, {
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

    const parts =
      json?.candidates?.[0]?.content?.parts || [];
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
      imageUrl: `data:image/png;base64,${base64img}`,
      debug: { provider, model, location, stage: "vertex_gemini" }
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: e?.message || String(e),
      stack: e?.stack || null
    });
  }
}
// === END GEMINI IMAGE GENERATION BRANCH ===

