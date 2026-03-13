import type { VercelRequest, VercelResponse } from "@vercel/node";
import { put } from "@vercel/blob";
import sharp from "sharp";

function jparse(t: string): any { try { return JSON.parse(t); } catch { return null; } }
function getBody(req: VercelRequest): any {
  const b: any = (req as any).body;
  if (!b) return {};
  if (typeof b === "string") return jparse(b) ?? {};
  return b;
}

function getPublicAssetBaseUrl() {
  return String(process.env.OAUTH_SERVER_URL || "").trim() || "https://mvstudiopro.fly.dev";
}

function buildBlobMediaUrlFromPath(pathname: string) {
  const normalized = String(pathname || "").replace(/^\/+/, "").trim();
  return `${getPublicAssetBaseUrl()}/api/jobs?op=blobMedia&blobPath=${encodeURIComponent(normalized)}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

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

    let out = await sharp(raw, { failOnError: false })
      .rotate()
      .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();

    if (out.length > 10 * 1024 * 1024) {
      out = await sharp(out, { failOnError: false }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
    }
    if (out.length > 10 * 1024 * 1024) {
      return res.status(400).json({ ok: false, error: "file_too_large_after_compress" });
    }

    const token = String(process.env.MVSP_READ_WRITE_TOKEN || "").trim();
    if (!token) return res.status(500).json({ ok: false, error: "missing_env_MVSP_READ_WRITE_TOKEN" });

    const safeName = filename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-") || "ref";
    const blob = await put(`refs/${Date.now()}-${safeName}.jpg`, out, {
      access: "public",
      token,
      contentType: "image/jpeg",
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
