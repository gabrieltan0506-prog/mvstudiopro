import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sendOtpMail } from "../../server/services/smtp-mailer";
import {
  EMAIL_RATE_LIMIT_MAX,
  IP_RATE_LIMIT_MAX,
  OTP_TTL_MS,
  captchaStore,
  consumeRateLimit,
  emailRateLimitStore,
  generateOtp,
  getClientIp,
  ipRateLimitStore,
  normalizeEmail,
  otpStore,
  pruneExpired,
  readBody,
  validateEmail,
} from "./state.js";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    pruneExpired();
    const body = readBody(req);

    const emailRaw = typeof body.email === "string" ? body.email : "";
    const captchaId = typeof body.captchaId === "string" ? body.captchaId : "";
    const captchaText = typeof body.captchaText === "string" ? body.captchaText : "";
    const email = normalizeEmail(emailRaw);

    if (!validateEmail(email)) {
      return res.status(400).json({ error: "请输入有效的邮箱地址" });
    }
    if (!captchaId || !captchaText.trim()) {
      return res.status(400).json({ error: "请完整填写图形验证码" });
    }

    const captchaRecord = captchaStore.get(captchaId);
    if (!captchaRecord || captchaRecord.expiresAt <= Date.now()) {
      captchaStore.delete(captchaId);
      return res.status(400).json({ error: "图形验证码已过期，请刷新后重试" });
    }

    if (captchaRecord.text.toUpperCase() !== captchaText.trim().toUpperCase()) {
      return res.status(400).json({ error: "图形验证码错误" });
    }

    captchaStore.delete(captchaId);

    const clientIp = getClientIp(req);
    if (!consumeRateLimit(emailRateLimitStore, email, EMAIL_RATE_LIMIT_MAX)) {
      return res.status(429).json({ error: "该邮箱请求过于频繁，请 10 分钟后再试" });
    }

    if (!consumeRateLimit(ipRateLimitStore, clientIp, IP_RATE_LIMIT_MAX)) {
      return res.status(429).json({ error: "请求过于频繁，请稍后再试" });
    }

    const otp = generateOtp();
    otpStore.set(email, {
      code: otp,
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
    });

    await sendOtpMail(email, otp);

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[Auth API] send-otp 失败:", error);
    const message = error instanceof Error ? error.message : "发送验证码失败，请稍后重试";
    return res.status(500).json({ error: message });
  }
}
