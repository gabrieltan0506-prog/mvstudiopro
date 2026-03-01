import type { VercelRequest, VercelResponse } from "@vercel/node";

function json(res: VercelResponse, body: any) {
  res.status(200);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function genImageWithApiKey(prompt: string) {
  const apiKey = mustEnv("GOOGLE_API_KEY");
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.0-flash-image-generation";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.8 }
  };

  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const ct = r.headers.get("content-type") || "";
  const text = await r.text();
  let j: any = null;
  try { j = ct.includes("application/json") ? JSON.parse(text) : null; } catch {}

  if (!r.ok) return { ok: false, status: r.status, raw: j || text };

  const parts = j?.candidates?.[0]?.content?.parts || [];
  const inline = parts.find((p: any) => p?.inlineData?.data);
  if (inline?.inlineData?.data) {
    const mime = inline.inlineData.mimeType || "image/png";
    return { ok: true, imageUrl: `data:${mime};base64,${inline.inlineData.data}`, raw: j };
  }
  return { ok: false, status: 200, raw: j, error: "no_image_data_in_response" };
}

function normalizeProvider(x: any): string {
  const raw = (x ?? "").toString().trim();
  const map: Record<string, string> = {
    "nano_flash": "nano-banana-flash",
    "nano-banana-flash": "nano-banana-flash",
    "nano-banana-pro": "nano-banana-pro",
    "kling_image": "kling_image",
    "kling_beijing": "kling_beijing",
    "kling": "kling_beijing",
  };
  return map[raw] || raw;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const body: any = req.body || {};
    const type = (body.type || req.query?.type || body.input?.type || "").toString();
    const provider = normalizeProvider(req.query?.provider ?? body.provider ?? body.input?.provider ?? body.job?.provider ?? body.payload?.provider);

    if (type === "image") {
      const resolvedProvider = provider || "nano-banana-flash";
      const prompt = (body.input?.prompt ?? body.prompt ?? req.query?.prompt ?? "").toString().trim();
      if (!prompt) return json(res, { ok: false, type: "image", error: "missing_prompt" });

      const out = await genImageWithApiKey(prompt);
      if (out.ok) return json(res, { ok: true, type: "image", provider: resolvedProvider, imageUrl: out.imageUrl });

      return json(res, { ok: false, type: "image", provider: resolvedProvider, error: "image_generation_failed", detail: out });
    }

    // 其他类型保持原系统，不在此 hotfix 里改
    return json(res, { ok: false, error: "unsupported_type_in_hotfix", type, provider });
  } catch (e: any) {
    return json(res, { ok: false, error: "server_error", detail: String(e?.message || e) });
  }
}
