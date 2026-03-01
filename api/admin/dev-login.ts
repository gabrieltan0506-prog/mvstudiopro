import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // 🔒 Only allow when secret key matches
  const secret = req.query.secret;

  if (secret !== process.env.DEV_ADMIN_SECRET) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  // Simulate admin session
  res.setHeader(
    "Set-Cookie",
    `dev_admin=true; Path=/; HttpOnly; SameSite=Lax`
  );

  return res.status(200).json({
    ok: true,
    role: "supervisor",
    message: "Dev admin login success"
  });
}
