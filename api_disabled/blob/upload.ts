import type { VercelRequest, VercelResponse } from "@vercel/node";
import { put } from "@vercel/blob";

function asString(v: any): string {
  if (v == null) return "";
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

function parseDataUrl(input: string): { mimeType: string; bytes: Buffer } | null {
  const m = input.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const mimeType = m[1] || "application/octet-stream";
  const b64 = m[2] || "";
  try {
    const bytes = Buffer.from(b64, "base64");
    return { mimeType, bytes };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,PUT,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    if (req.method !== "POST" && req.method !== "PUT") {
      return res.status(405).json({ ok: false, error: "Method not allowed", method: req.method, allow: ["POST", "PUT", "OPTIONS"] });
    }

    const b: any = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const fileName = asString(b.fileName || "reference-image").replace(/[^a-zA-Z0-9._-]/g, "_");
    const dataUrl = asString(b.dataUrl);

    if (!dataUrl) {
      return res.status(400).json({ ok: false, error: "missing_data_url" });
    }

    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      return res.status(400).json({ ok: false, error: "invalid_data_url" });
    }

    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(parsed.mimeType)) {
      return res.status(400).json({ ok: false, error: "unsupported_mime_type", detail: parsed.mimeType });
    }

    if (parsed.bytes.length === 0) {
      return res.status(400).json({ ok: false, error: "empty_file" });
    }
    if (parsed.bytes.length > 5 * 1024 * 1024) {
      return res.status(413).json({ ok: false, error: "file_too_large", detail: "Max 5MB after optimization" });
    }

    const extension = parsed.mimeType === "image/png" ? "png" : parsed.mimeType === "image/webp" ? "webp" : "jpg";
    const pathname = `veo-input/${Date.now()}-${fileName}.${extension}`;

    const blob = await put(pathname, parsed.bytes, {
      access: "private",
      contentType: parsed.mimeType,
      addRandomSuffix: true,
    });

    return res.status(200).json({
      ok: true,
      url: blob.url,
      downloadUrl: (blob as any).downloadUrl || null,
      pathname: blob.pathname,
      contentType: parsed.mimeType,
    });
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: "upload_failed",
      message: e?.message || String(e),
      detail: {
        hasBlobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      },
    });
  }
}
