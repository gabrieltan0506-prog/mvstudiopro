
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Unified image generation endpoint for Gemini models.
 * Supports:
 *  - flash:  gemini-2.5-flash-image
 *  - pro:    gemini-3-pro-image-preview
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Only support GET for now
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // Parse query parameters
    const type     = String(req.query?.type || "");
    const prompt   = String(req.query?.prompt || "");
    const provider = String(req.query?.provider || "nano-banana-flash");

    // Health check
    if (!type && !prompt) {
      return res.status(200).json({ ok: true, message: "jobs endpoint reachable" });
    }

    // Validate image request
    if (type !== "image") {
      return res.status(400).json({ ok: false, error: "unsupported_type", type });
    }
    if (!prompt) {
      return res.status(400).json({ ok: false, error: "missing_prompt" });
    }

    // Determine model from provider
    const model =
      provider === "nano-banana-pro"
        ? process.env.VERTEX_IMAGE_MODEL_PRO
        : process.env.VERTEX_IMAGE_MODEL_FLASH;

    const projectId = String(process.env.VERTEX_PROJECT_ID || "");
    const location  = String(process.env.VERTEX_LOCATION || "global");

    // Vertex Gemini Image generateContent
    // Construct auth token from GOOGLE_APPLICATION_CREDENTIALS_JSON
    async function getVertexAccessToken(): Promise<string> {
      const raw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
      if (!raw) throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS_JSON");
      const sa = JSON.parse(raw);
      const jwtHeader = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
      const now = Math.floor(Date.now() / 1000);
      const jwtPayload = Buffer.from(JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600
      })).toString("base64url");
      const unsignedToken = `${jwtHeader}.${jwtPayload}`;
      const signer = require("crypto").createSign("RSA-SHA256");
      signer.update(unsignedToken);
      signer.end();
      const privateKey = sa.private_key;
      const signature = signer.sign(privateKey).toString("base64url");
      const assertion = `${unsignedToken}.${signature}`;

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion
        }).toString()
      });
      const tokenJson = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !tokenJson.access_token) {
        throw new Error(`vertex token gen failed: ${JSON.stringify(tokenJson)}`);
      }
      return tokenJson.access_token;
    }

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
        "Authorization": \`Bearer \${token}\`,
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

    // Extract base64
    const parts = json?.candidates?.[0]?.content?.parts || [];
    let base64img: string | null = null;
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
      imageUrl: \`data:image/png;base64,\${base64img}\`,
      debug: { provider, model, location, stage: "vertex_gemini" }
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
