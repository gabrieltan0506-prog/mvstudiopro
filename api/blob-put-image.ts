import type { VercelRequest, VercelResponse } from "@vercel/node";
import { put } from "@vercel/blob";

function jparse(t: string): any { try { return JSON.parse(t); } catch { return null; } }
function getBody(req: VercelRequest): any {
  const b: any = (req as any).body;
  if (!b) return {};
  if (typeof b === "string") return jparse(b) ?? {};
  return b;
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

    const mime = m[1];
    const b64 = m[2];
    const buf = Buffer.from(b64, "base64");
    if (!buf.length) return res.status(400).json({ ok: false, error: "empty_file" });
    if (buf.length > 10 * 1024 * 1024) return res.status(400).json({ ok: false, error: "file_too_large" });

    // Your store is private; keep it private.
    const blob = await put(`refs/${Date.now()}-${filename}`, buf, { access: "private", contentType: mime });
    return res.status(200).json({ ok: true, imageUrl: `${blob.url}?download=1`, blobUrl: blob.url });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: "server_error", message: e?.message || String(e) });
  }
}
