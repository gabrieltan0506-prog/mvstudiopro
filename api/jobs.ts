import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    return res.status(200).json({
      status: "ok",
      message: "jobs endpoint reachable"
    });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
