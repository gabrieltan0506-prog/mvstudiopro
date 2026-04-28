/**
 * SMS OTP Auth Routes — Route B (预备路由)
 *
 * 目前返回 501 Not Implemented。
 * 接入阿里云 SMS / 腾讯云 SMS 后，取消 TODO 注解并填入实现即可。
 *
 * 环境变量（接入时填入）：
 *   ALIYUN_SMS_ACCESS_KEY_ID
 *   ALIYUN_SMS_ACCESS_KEY_SECRET
 *   ALIYUN_SMS_SIGN_NAME       (短信签名，例如「MVStudioPro」)
 *   ALIYUN_SMS_TEMPLATE_CODE   (模板 CODE，例如「SMS_123456789」)
 */

import type { Express, Request } from "express";
import { randomInt } from "crypto";

// ─── In-memory store（与邮件 OTP 相同结构，接入时可复用） ───
type OtpRecord = { code: string; expiresAt: number; attempts: number };
type RateLimitRecord = { count: number; resetAt: number };

const SMS_OTP_TTL_MS = 5 * 60 * 1000;       // 5 分钟有效
const SMS_OTP_MAX_ATTEMPTS = 5;
const SMS_RATE_LIMIT_MAX = 3;                 // 同一手机号 3次/10分钟
const SMS_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const smsOtpStore = new Map<string, OtpRecord>();
const smsRateLimitStore = new Map<string, RateLimitRecord>();

function validatePhone(phone: string): boolean {
  // 支持 +86 开头或纯 11 位数字
  return /^(\+?86)?1[3-9]\d{9}$/.test(phone.replace(/\s/g, ""));
}

function normalizePhone(phone: string): string {
  return phone.replace(/\s/g, "").replace(/^\+?86/, "");
}

function consumeRateLimit(phone: string): boolean {
  const now = Date.now();
  const record = smsRateLimitStore.get(phone);
  if (!record || record.resetAt <= now) {
    smsRateLimitStore.set(phone, { count: 1, resetAt: now + SMS_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (record.count >= SMS_RATE_LIMIT_MAX) return false;
  record.count += 1;
  return true;
}

function generateSmsOtp(): string {
  return String(randomInt(100000, 1000000));
}

/**
 * TODO: 接入阿里云 SMS 时，取消以下注解并安装依赖：
 *   pnpm add @alicloud/pop-core
 *
 * async function sendSmsViaAliyun(phone: string, otp: string): Promise<void> {
 *   const RPCClient = require("@alicloud/pop-core");
 *   const client = new RPCClient({
 *     accessKeyId: process.env.ALIYUN_SMS_ACCESS_KEY_ID!,
 *     accessKeySecret: process.env.ALIYUN_SMS_ACCESS_KEY_SECRET!,
 *     endpoint: "https://dysmsapi.aliyuncs.com",
 *     apiVersion: "2017-05-25",
 *   });
 *   await client.request("SendSms", {
 *     PhoneNumbers: phone,
 *     SignName: process.env.ALIYUN_SMS_SIGN_NAME!,
 *     TemplateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE!,
 *     TemplateParam: JSON.stringify({ code: otp }),
 *   }, { method: "POST" });
 * }
 */

export function registerSmsAuthRoutes(app: Express) {
  /**
   * POST /api/auth/send-sms-otp
   * body: { phone: string, captchaId: string, captchaText: string }
   *
   * 目前状态：501 Not Implemented（路由预备，待接入简讯 API）
   */
  app.post("/api/auth/send-sms-otp", (req, res) => {
    const phoneRaw = typeof req.body?.phone === "string" ? req.body.phone : "";
    const phone = normalizePhone(phoneRaw);

    if (!validatePhone(phone)) {
      return res.status(400).json({ error: "请输入有效的手机号码" });
    }

    // ── 接入后取消以下注解 ──
    // if (!consumeRateLimit(phone)) {
    //   return res.status(429).json({ error: "该手机号请求过于频繁，请 10 分钟后再试" });
    // }
    // const otp = generateSmsOtp();
    // smsOtpStore.set(phone, { code: otp, expiresAt: Date.now() + SMS_OTP_TTL_MS, attempts: 0 });
    // await sendSmsViaAliyun(phone, otp);
    // return res.status(200).json({ ok: true });

    return res.status(501).json({
      error: "手机简讯登录即将开放，请使用邮箱登录",
      code: "SMS_NOT_IMPLEMENTED",
    });
  });

  /**
   * POST /api/auth/verify-sms-otp
   * body: { phone: string, otp: string }
   *
   * 目前状态：501 Not Implemented（路由预备，待接入简讯 API）
   */
  app.post("/api/auth/verify-sms-otp", (req, res) => {
    const phoneRaw = typeof req.body?.phone === "string" ? req.body.phone : "";
    const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
    const phone = normalizePhone(phoneRaw);

    if (!validatePhone(phone)) {
      return res.status(400).json({ error: "请输入有效的手机号码" });
    }
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: "请输入 6 位数字验证码" });
    }

    // ── 接入后取消以下注解 ──
    // const record = smsOtpStore.get(phone);
    // if (!record) return res.status(400).json({ error: "请先发送验证码" });
    // if (record.expiresAt <= Date.now()) {
    //   smsOtpStore.delete(phone);
    //   return res.status(400).json({ error: "验证码已过期，请重新发送" });
    // }
    // if (record.attempts >= SMS_OTP_MAX_ATTEMPTS) {
    //   smsOtpStore.delete(phone);
    //   return res.status(429).json({ error: "验证失败次数过多，请重新发送" });
    // }
    // record.attempts += 1;
    // if (record.code !== otp) {
    //   const remaining = SMS_OTP_MAX_ATTEMPTS - record.attempts;
    //   return res.status(400).json({ error: `验证码错误，还可尝试 ${remaining} 次` });
    // }
    // smsOtpStore.delete(phone);
    // ... 查找或创建用户，创建 session，返回 { ok: true }

    return res.status(501).json({
      error: "手机简讯登录即将开放，请使用邮箱登录",
      code: "SMS_NOT_IMPLEMENTED",
    });
  });
}
