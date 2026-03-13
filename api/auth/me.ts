import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SESSION_COOKIE, parseCookie, verifySession } from "../../server/vercel-auth/session.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const secret = String(process.env.AUTH_SESSION_SECRET || process.env.DEV_ADMIN_SECRET || "");
    if (!secret) return res.status(500).json({ ok: false, error: "missing_env", detail: "AUTH_SESSION_SECRET" });

    const token = parseCookie(req.headers.cookie, SESSION_COOKIE);
    const session = verifySession(token, secret);

    if (!session) {
      return res.status(200).json({ ok: true, loggedIn: false, user: null });
    }

    return res.status(200).json({
      ok: true,
      loggedIn: true,
      user: {
        email: session.email,
        role: session.role || "user"
      }
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: "server_error", message: e?.message || String(e) });
  }
}
