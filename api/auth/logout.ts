import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildLogoutCookie } from "./_session.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
    res.setHeader("Set-Cookie", buildLogoutCookie());
    return res.status(200).json({ ok: true, loggedIn: false });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: "server_error", message: e?.message || String(e) });
  }
}
