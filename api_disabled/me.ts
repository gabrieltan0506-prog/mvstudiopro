import type { VercelRequest, VercelResponse } from "@vercel/node";

function parseCookies(h?: string) {
  const out: Record<string,string> = {};
  if (!h) return out;
  for (const part of h.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("="));
  }
  return out;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  const c = parseCookies(req.headers.cookie);
  if (c.dev_admin === "true") {
    return res.status(200).json({
      ok: true,
      user: { id: "dev_admin", email: "dev-admin@local", role: "supervisor" },
      credits: 999999,
      verifyStatus: "approved"
    });
  }
  return res.status(200).json({ ok: false });
}
