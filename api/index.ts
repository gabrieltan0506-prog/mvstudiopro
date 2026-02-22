import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createApp } from "../server/_core/app";

const app = createApp();

export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req as any, res as any);
}
