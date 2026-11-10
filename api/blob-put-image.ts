import type { VercelRequest, VercelResponse } from "@vercel/node";
import { putPublicStoredMedia as put } from "../server/services/publicStoredMedia";

function jparse(t: string): any { try { return JSON.parse(t); } catch { return null; } }
function getBody(req: VercelRequest): any {
  const b: any = (req as any).body;
  if (!b) return {};
  if (typeof b === "string") return jparse(b) ?? {};
  return b;
}

function getPublicAssetBaseUrl() {
  return String(process.env.OAUTH_SERVER_URL || "").trim() || "https://mvstudiopro.com";
}

function buildBlobMediaUrlFromPath(pathname: string) {
  const normalized = String(pathname || "").replace(/^\/+/, "").trim();
  return `${getPublicAssetBaseUrl()}/api/jobs?op=blobMedia&blobPath=${encodeURIComponent(normalized)}`;
}

async function resolveBlobPutUser(req: VercelRequest): Promise<number | "unavailable" | null> {
  try {
    const { sdk } = await import("../server/_core/sdk.js");
    const user = await sdk.authenticateRequest(req as any, { silentMissing: true });
    const userId = Number((user as any)?.id);
    return Number.isFinite(userId) && userId > 0 ? userId : null;
  } catch (error) {
    return Number((error as any)?.statusCode) >= 500 ? "unavailable" : null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
    // 须登录（原入口不认人，任何人可往公开存储写图）。调用页（工作流、分镜成片、复刻工作室、测试台）下游都要登录。
    const viewer = await resolveBlobPutUser(req);
    if (viewer === "unavailable") return res.status(503).json({ ok: false, error: "auth_unavailable", message: "服务暂时不可用，请稍后重试" });
    if (!viewer) return res.status(401).json({ ok: false, error: "authentication_required", message: "请先登录后再上传图片" });

    const b = getBody(req);
    const dataUrl = String(b.dataUrl || "");
    const filename = String(b.filename || "ref.png") || "ref.png";
    if (!dataUrl.startsWith("data:")) return res.status(400).json({ ok: false, error: "missing_data_url" });

    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ ok: false, error: "invalid_data_url" });

    const b64 = m[2];
    const raw = Buffer.from(b64, "base64");
    if (!raw.length) return res.status(400).json({ ok: false, error: "empty_file" });
    if (raw.length > 20 * 1024 * 1024) return res.status(400).json({ ok: false, error: "file_too_large_raw" });

    const contentType = String(m[1] || "image/jpeg").trim() || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : contentType.includes("gif") ? "gif" : "jpg";
    const safeName = filename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-") || "ref";
    const blob = await put(`refs/${Date.now()}-${safeName}.${ext}`, raw, {
      access: "public",
      contentType,
    });

    return res.status(200).json({
      ok: true,
      imageUrl: buildBlobMediaUrlFromPath(String(blob.pathname || "")),
      blobUrl: blob.url,
      blobPath: blob.pathname,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: "server_error", message: e?.message || String(e) });
  }
}
