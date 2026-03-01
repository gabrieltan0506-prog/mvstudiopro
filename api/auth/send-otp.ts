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
  validateEmail,
} from "./state.js";

export const config = {
  runtime: "nodejs",
};

type RequestBody = {
  email?: unknown;
  captchaId?: unknown;
  captchaText?: unknown;
};

function parseBody(req: VercelRequest): RequestBody {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body) as RequestBody;
    } catch {
      return {};
    }
  }
  if (req.body && typeof req.body === "object") {
    return req.body as RequestBody;
  }
  return {};
}

function truncateError(error: unknown, maxLen: number = 180): string {
  const message = error instanceof Error ? error.message : String(error ?? "unknown error");
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > maxLen ? `${compact.slice(0, maxLen)}...` : compact;
}

function hasTencentSesConfig(): boolean {
  return Boolean(
    process.env.TENCENT_SECRET_ID?.trim() &&
      process.env.TENCENT_SECRET_KEY?.trim() &&
      process.env.TENCENT_SES_REGION?.trim() &&
      process.env.TENCENT_SES_FROM_EMAIL?.trim() &&
      process.env.TENCENT_SES_TEMPLATE_ID?.trim()
  );
}

async function sendByTencentSes(toEmail: string, otp: string): Promise<void> {
  const secretId = process.env.TENCENT_SECRET_ID?.trim();
  const secretKey = process.env.TENCENT_SECRET_KEY?.trim();
  const region = process.env.TENCENT_SES_REGION?.trim();
  const fromEmail = process.env.TENCENT_SES_FROM_EMAIL?.trim();
  const templateId = Number(process.env.TENCENT_SES_TEMPLATE_ID?.trim());

  if (!secretId || !secretKey || !region || !fromEmail || !Number.isFinite(templateId) || templateId <= 0) {
    throw new Error("Tencent SES 配置缺失或无效");
  }

  const tencentcloud = await import("tencentcloud-sdk-nodejs");
  const SesClient = tencentcloud.default.ses.v20201002.Client;
  const client = new SesClient({
    credential: { secretId, secretKey },
    region,
    profile: {
      httpProfile: {
        endpoint: "ses.tencentcloudapi.com",
      },
    },
  });

  // 模板变量请在腾讯 SES 模板中按顺序配置（例如：验证码、有效分钟数）
  const params = {
    FromEmailAddress: fromEmail,
    Destination: [toEmail],
    Template: {
      TemplateID: templateId,
      TemplateData: JSON.stringify([otp, "10"]),
    },
  };

  await client.SendEmail(params);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    pruneExpired();
    const body = parseBody(req);

    const emailRaw = typeof body.email === "string" ? body.email : "";
    const captchaId = typeof body.captchaId === "string" ? body.captchaId : "";
    const captchaText = typeof body.captchaText === "string" ? body.captchaText : "";
    const email = normalizeEmail(emailRaw);

    if (!validateEmail(email)) {
      return res.status(400).json({ ok: false, error: "请输入有效的邮箱地址" });
    }
    if (!captchaId || !captchaText.trim()) {
      return res.status(400).json({ ok: false, error: "请完整填写图形验证码" });
    }

    const captchaRecord = captchaStore.get(captchaId);
    if (!captchaRecord || captchaRecord.expiresAt <= Date.now()) {
      captchaStore.delete(captchaId);
      return res.status(400).json({ ok: false, error: "图形验证码已过期，请刷新后重试" });
    }

    if (captchaRecord.text.toUpperCase() !== captchaText.trim().toUpperCase()) {
      return res.status(400).json({ ok: false, error: "图形验证码错误" });
    }

    captchaStore.delete(captchaId);

    const clientIp = getClientIp(req);
    if (!consumeRateLimit(emailRateLimitStore, email, EMAIL_RATE_LIMIT_MAX)) {
      return res.status(429).json({ ok: false, error: "该邮箱请求过于频繁，请 10 分钟后再试" });
    }
    if (!consumeRateLimit(ipRateLimitStore, clientIp, IP_RATE_LIMIT_MAX)) {
      return res.status(429).json({ ok: false, error: "请求过于频繁，请稍后再试" });
    }

    const otp = generateOtp();
    otpStore.set(email, {
      code: otp,
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
    });

    if (!hasTencentSesConfig()) {
      return res.status(500).json({ ok: false, error: "邮件服务未配置" });
    }

    try {
      await sendByTencentSes(email, otp);
      return res.status(200).json({ ok: true });
    } catch (sendError) {
      return res.status(500).json({
        ok: false,
        error: "发送失败",
        detail: truncateError(sendError),
      });
    }
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "发送失败",
      detail: truncateError(error),
    });
  }
}
