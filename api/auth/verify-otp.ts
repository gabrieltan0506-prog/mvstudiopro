import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  // TEMP: build-unblock stub. Restore full OTP flow later.
  res.status(501).json({ ok: false, error: "not_implemented", message: "verify-otp temporarily disabled" });
}
