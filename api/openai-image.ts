import type { VercelRequest, VercelResponse } from "@vercel/node";
import { putPublicStoredMedia as put } from "../server/services/publicStoredMedia";
import { hasSupervisorRole } from "../shared/internalMediaEndpointPolicy.js";

/** 取登录用户与角色；未登录/校验失败返回 null（不抛）。 */
async function resolveViewer(req: VercelRequest): Promise<{ userId: number; role: string } | null> {
  try {
    const { sdk } = await import("../server/_core/sdk.js");
    const user = await sdk.authenticateRequest(req as any, { silentMissing: true });
    const userId = Number((user as any)?.id);
    if (!Number.isFinite(userId) || userId <= 0) return null;
    return { userId, role: String((user as any)?.role || "") };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  // 付费上游：仓库内无调用方，原先匿名可调；收口为只许监管/管理员（同 /api/kling-image）。
  const viewer = await resolveViewer(req);
  if (!viewer) return res.status(401).json({ ok: false, error: "authentication_required", message: "请先登录后再使用" });
  if (!hasSupervisorRole(viewer.role)) return res.status(403).json({ ok: false, error: "supervisor_only", message: "该入口仅供监管验收" });

  const apiKey = String(process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return res.status(500).json({ ok: false, error: "image_service_unavailable" });

  const body: any = (req as any).body || {};
  const prompt = String(body.prompt || "").trim();
  const model = String(body.model || "gpt-image-2").trim();
  const size = String(body.size || "1024x1024").trim();
  const quality = String(body.quality || "high").trim();
  const n = Number(body.n || 1);

  if (!prompt) return res.status(400).json({ ok: false, error: "missing_prompt" });

  try {
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, prompt, n, size, quality, response_format: "b64_json" }),
    });

    const json: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      const errMsg = json?.error?.message || `HTTP ${r.status}`;
      console.error("[openai-image] failed:", errMsg);
      return res.status(r.status).json({ ok: false, error: errMsg });
    }

    const items: any[] = json?.data || [];
    const imageUrls: string[] = [];

    for (const item of items) {
      const b64 = String(item?.b64_json || "").trim();
      if (!b64) continue;
      const buf = Buffer.from(b64, "base64");
      const blob = await put(`gpt-image-${Date.now()}.png`, buf, { access: "public", contentType: "image/png" });
      imageUrls.push(blob.url);
    }

    if (imageUrls.length === 0) return res.status(500).json({ ok: false, error: "no image returned" });

    // 模型名不回前端（前台零技术泄漏）；请求与模型选择不变。
    return res.json({ ok: true, imageUrl: imageUrls[0], imageUrls, size, quality });
  } catch (e: any) {
    console.error("[openai-image] error:", e?.message);
    return res.status(500).json({ ok: false, error: e?.message || "unknown error" });
  }
}
