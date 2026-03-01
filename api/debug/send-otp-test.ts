import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return res.status(200).json({
    method: req.method,
    body: req.body,
    ok: true
  });
}
