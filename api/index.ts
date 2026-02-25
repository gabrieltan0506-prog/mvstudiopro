import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.url?.startsWith("/api/health")) {
    return res.status(200).send("ok");
  }
  return res.status(404).send("Not Found");
}