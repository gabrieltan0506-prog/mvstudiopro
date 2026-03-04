import type { VercelRequest, VercelResponse } from "@vercel/node";
import {

const __AUTH_STATE__ = (globalThis as any).__AUTH_STATE__ || ((globalThis as any).__AUTH_STATE__ = {
  captchas: new Map<string, { text: string; exp: number }>(),
  otps: new Map<string, { code: string; exp: number }>(),
});

function nowMs() { return Date.now(); }
function sweep(map: Map<string, { exp: number }>) {
  const n = nowMs();
  for (const [k, v] of map.entries()) if (v.exp <= n) map.delete(k);
}
  CAPTCHA_TTL_MS,
  captchaStore,
  generateCaptchaImage,
  generateCaptchaText,
  pruneExpired,
} from "./state.js";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  pruneExpired();
  const captchaId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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
