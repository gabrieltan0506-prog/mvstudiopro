import type { VercelRequest, VercelResponse } from "@vercel/node";

function parseCookie(header: string | undefined) {
  const out: Record<string,string> = {};
  if (!header) return out;
  header.split(";").forEach(p => {
    const [k, ...rest] = p.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(rest.join("=") || "");
  });
  return out;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  const cookies = parseCookie(req.headers.cookie);
  const isDevAdmin = cookies["dev_admin"] === "true";

  if (isDevAdmin) {
    return res.status(200).json({
      ok: true,
      user: { id: "dev_admin", email: "dev-admin@local", role: "supervisor" },
      credits: 999999,
      verifyStatus: "approved"
    });
  }

  // fallback：没登录
  return res.status(200).json({ ok: false });
}
