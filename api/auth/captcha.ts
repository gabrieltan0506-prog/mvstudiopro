import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "crypto";
import {
  CAPTCHA_TTL_MS,
  captchaStore,
  generateCaptchaImage,
  generateCaptchaText,
  pruneExpired,
} from "./_state";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  pruneExpired();
  const captchaId = randomUUID();
  const text = generateCaptchaText();

  captchaStore.set(captchaId, {
    text,
    expiresAt: Date.now() + CAPTCHA_TTL_MS,
  });

  return res.status(200).json({
    imageBase64: generateCaptchaImage(text),
    captchaId,
  });
}
