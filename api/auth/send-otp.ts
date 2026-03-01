import type { VercelRequest, VercelResponse } from "@vercel/node";
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

function hasSmtpConfig(): boolean {
  const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const;
  return required.every((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function hasTencentSesConfig(): boolean {
  return Boolean(
    process.env.TENCENT_SECRET_ID &&
      process.env.TENCENT_SECRET_KEY &&
      process.env.TENCENT_SES_REGION &&
      process.env.TENCENT_SES_FROM_EMAIL
  );
}

function truncateErrorMessage(error: unknown, maxLen: number = 180): string {
  const message = error instanceof Error ? error.message : String(error ?? "unknown error");
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > maxLen ? `${compact.slice(0, maxLen)}...` : compact;
}

async function sendBySmtp(email: string, otp: string): Promise<void> {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !Number.isFinite(port) || !user || !pass || !from) {
    throw new Error("SMTP 配置缺失");
  }

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to: email,
    subject: "MVStudioPro 登录验证码",
    text: `您的登录验证码是：${otp}。验证码 10 分钟内有效。`,
    html: `<p>您的登录验证码是：<b style=\"font-size:20px\">${otp}</b></p><p>验证码 10 分钟内有效，请勿泄露给他人。</p>`,
  });
}

async function sendByTencentSes(email: string, otp: string): Promise<void> {
  const secretId = process.env.TENCENT_SECRET_ID?.trim();
  const secretKey = process.env.TENCENT_SECRET_KEY?.trim();
  const region = process.env.TENCENT_SES_REGION?.trim();
  const fromEmail = process.env.TENCENT_SES_FROM_EMAIL?.trim();
  if (!secretId || !secretKey || !region || !fromEmail) {
    throw new Error("Tencent SES 配置缺失");
  }

  const tencentcloud = await import("tencentcloud-sdk-nodejs");
  const SesClient = tencentcloud.default.ses.v20201002.Client;
  const client = new SesClient({
    credential: { secretId, secretKey },
    region,
    profile: { httpProfile: { endpoint: "ses.tencentcloudapi.com" } },
  });

  const text = `您的登录验证码是：${otp}。验证码 10 分钟内有效。`;
  const html = `<p>您的登录验证码是：<b style=\"font-size:20px\">${otp}</b></p><p>验证码 10 分钟内有效，请勿泄露给他人。</p>`;
  const params = {
    FromEmailAddress: fromEmail,
    Destination: [email],
    Subject: "MVStudioPro 登录验证码",
    Simple: {
      Html: Buffer.from(html, "utf8").toString("base64"),
      Text: Buffer.from(text, "utf8").toString("base64"),
    },
  };
  await client.SendEmail(params);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
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

    const mailProvider = (process.env.MAIL_PROVIDER ?? "").trim().toLowerCase();
    const smtpReady = hasSmtpConfig();
    const tencentReady = hasTencentSesConfig();

    if (!smtpReady && !tencentReady) {
      return res.status(500).json({ ok: false, error: "邮件服务未配置" });
    }

    try {
      if (mailProvider === "tencent") {
        if (!tencentReady) {
          return res.status(500).json({ ok: false, error: "邮件服务未配置" });
        }
        await sendByTencentSes(email, otp);
      } else if (smtpReady) {
        await sendBySmtp(email, otp);
      } else if (tencentReady) {
        await sendByTencentSes(email, otp);
      } else {
        return res.status(500).json({ ok: false, error: "邮件服务未配置" });
      }
    } catch (sendError) {
      console.error("[Auth API] send-otp 发送失败:", sendError);
      return res.status(500).json({
        ok: false,
        error: "发送失败",
        detail: truncateErrorMessage(sendError),
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[Auth API] send-otp 失败:", error);
    return res.status(500).json({
      ok: false,
      error: "发送失败",
      detail: truncateErrorMessage(error),
    });
  }
}
