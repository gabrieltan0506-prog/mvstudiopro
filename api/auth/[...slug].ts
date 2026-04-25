import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  SESSION_COOKIE,
  parseCookie,
  verifySession,
  signSession,
  buildSessionCookie,
  buildLogoutCookie,
} from "../../server/vercel-auth/session.js";

function jparse(t: string): any { try { return JSON.parse(t); } catch { return null; } }
function getBody(req: VercelRequest): any {
  const b: any = (req as any).body;
  if (!b) return {};
  if (typeof b === "string") return jparse(b) ?? {};
  return b;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const slug = Array.isArray(req.query.slug) ? req.query.slug.join("/") : String(req.query.slug ?? "");

  try {
    // GET /api/auth/me
    if (slug === "me") {
      if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
      const secret = String(process.env.AUTH_SESSION_SECRET || process.env.DEV_ADMIN_SECRET || "");
      if (!secret) return res.status(500).json({ ok: false, error: "missing_env", detail: "AUTH_SESSION_SECRET" });
      const token = parseCookie(req.headers.cookie, SESSION_COOKIE);
      const session = verifySession(token, secret);
      if (!session) return res.status(200).json({ ok: true, loggedIn: false, user: null });
      return res.status(200).json({ ok: true, loggedIn: true, user: { email: session.email, role: session.role || "user" } });
    }

    // POST /api/auth/login
    if (slug === "login") {
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
      const secret = String(process.env.AUTH_SESSION_SECRET || process.env.DEV_ADMIN_SECRET || "");
      const emailEnv = String(process.env.APP_LOGIN_EMAIL || "");
      const passwordEnv = String(process.env.APP_LOGIN_PASSWORD || "");
      if (!secret || !emailEnv || !passwordEnv) {
        return res.status(500).json({ ok: false, error: "missing_env", detail: "AUTH_SESSION_SECRET / APP_LOGIN_EMAIL / APP_LOGIN_PASSWORD" });
      }
      const b = getBody(req);
      const email = String(b.email || "").trim().toLowerCase();
      const password = String(b.password || "");
      if (email !== emailEnv.trim().toLowerCase() || password !== passwordEnv) {
        return res.status(401).json({ ok: false, error: "invalid_credentials" });
      }
      const token = signSession({ email, role: "admin", exp: Date.now() + 1000 * 60 * 60 * 24 * 7 }, secret);
      res.setHeader("Set-Cookie", buildSessionCookie(token));
      return res.status(200).json({ ok: true, loggedIn: true, user: { email, role: "admin" } });
    }

    // POST /api/auth/logout
    if (slug === "logout") {
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
      res.setHeader("Set-Cookie", buildLogoutCookie());
      return res.status(200).json({ ok: true, loggedIn: false });
    }

    return res.status(404).json({ ok: false, error: "not_found" });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: "server_error", message: e?.message || String(e) });
  }
}
