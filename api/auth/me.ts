import type { VercelRequest, VercelResponse } from "@vercel/node";

function hasAdminCookie(req: VercelRequest) {
  const cookie = String(req.headers.cookie || "");
  return cookie.includes("mvsp_admin=1");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

    if (hasAdminCookie(req)) {
      return res.status(200).json({
        ok: true,
        loggedIn: true,
        user: { email: "dev-admin@local", role: "admin" },
      });
    }

    // 未登录（之后你接真正登录系统时，把这里换成真实 session）
    return res.status(200).json({ ok: true, loggedIn: false, user: null });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: "server_error", message: e?.message || String(e) });
  }
}
