import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";

function safeEq(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

    const key = String((req.query as any)?.key || "");
    const secret =
      String(process.env.ADMIN_DEV_LOGIN_KEY || process.env.ADMIN_SECRET || process.env.ADMIN_KEY || "");

    if (!secret) return res.status(500).send("Missing ADMIN_DEV_LOGIN_KEY (or ADMIN_SECRET)");
    if (!key || !safeEq(key, secret)) return res.status(401).send("Unauthorized");

    // 24h admin cookie (dev only)
    const cookie = [
      "mvsp_admin=1",
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Secure",
      "Max-Age=86400",
    ].join("; ");

    res.setHeader("Set-Cookie", cookie);

    // 改成你后台实际路径（如果不是 /admin）
    res.statusCode = 302;
    res.setHeader("Location", "/admin");
    res.end();
  } catch (e: any) {
    res.status(500).send(e?.message || String(e));
  }
}
