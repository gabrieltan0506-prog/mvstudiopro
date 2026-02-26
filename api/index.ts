import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).setHeader("Allow", "GET").send("Method Not Allowed");
    }

    res.setHeader("Content-Security-Policy", "default-src 'self'");
    return res.status(200).send("ok");
  } catch (error) {
    console.error(error);
    return res.status(500).send("Internal Server Error");
  }
}
