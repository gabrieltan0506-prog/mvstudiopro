import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getEnvStatus } from "../server/vercel-api-core/env.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  return res.status(200).json({
    ok: true,
    env: getEnvStatus(),
  });
}
