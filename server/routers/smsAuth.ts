/**
 * SMS OTP Auth Routes — Route B (預備路由)
 *
 * 目前返回 501 Not Implemented。
 * 接入阿里雲 SMS / 騰訊雲 SMS 後，取消 TODO 註解並填入實現即可。
 *
 * 環境變量（接入時填入）：
 *   ALIYUN_SMS_ACCESS_KEY_ID
 *   ALIYUN_SMS_ACCESS_KEY_SECRET
 *   ALIYUN_SMS_SIGN_NAME       (短信簽名，例如「MVStudioPro」)
 *   ALIYUN_SMS_TEMPLATE_CODE   (模板 CODE，例如「SMS_123456789」)
 */

import type { Express, Request } from "express";
import { randomInt } from "crypto";

// ─── In-memory store（與郵件 OTP 相同結構，接入時可複用） ───
type OtpRecord = { code: string; expiresAt: number; attempts: number };
type RateLimitRecord = { count: number; resetAt: number };

const SMS_OTP_TTL_MS = 5 * 60 * 1000;       // 5 分鐘有效
const SMS_OTP_MAX_ATTEMPTS = 5;
const SMS_RATE_LIMIT_MAX = 3;                 // 同一手機號 3次/10分鐘
const SMS_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const smsOtpStore = new Map<string, OtpRecord>();
const smsRateLimitStore = new Map<string, RateLimitRecord>();

function validatePhone(phone: string): boolean {
  // 支持 +86 開頭或純 11 位數字
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
 * TODO: 接入阿里雲 SMS 時，取消以下註解並安裝依賴：
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
   * 目前狀態：501 Not Implemented（路由預備，待接入簡訊 API）
   */
  app.post("/api/auth/send-sms-otp", (req, res) => {
    const phoneRaw = typeof req.body?.phone === "string" ? req.body.phone : "";
    const phone = normalizePhone(phoneRaw);

    if (!validatePhone(phone)) {
      return res.status(400).json({ error: "請輸入有效的手機號碼" });
    }

    // ── 接入後取消以下註解 ──
    // if (!consumeRateLimit(phone)) {
    //   return res.status(429).json({ error: "該手機號請求過於頻繁，請 10 分鐘後再試" });
    // }
    // const otp = generateSmsOtp();
    // smsOtpStore.set(phone, { code: otp, expiresAt: Date.now() + SMS_OTP_TTL_MS, attempts: 0 });
    // await sendSmsViaAliyun(phone, otp);
    // return res.status(200).json({ ok: true });

    return res.status(501).json({
      error: "手機簡訊登入即將開放，請使用郵箱登入",
      code: "SMS_NOT_IMPLEMENTED",
    });
  });

  /**
   * POST /api/auth/verify-sms-otp
   * body: { phone: string, otp: string }
   *
   * 目前狀態：501 Not Implemented（路由預備，待接入簡訊 API）
   */
  app.post("/api/auth/verify-sms-otp", (req, res) => {
    const phoneRaw = typeof req.body?.phone === "string" ? req.body.phone : "";
    const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
    const phone = normalizePhone(phoneRaw);

    if (!validatePhone(phone)) {
      return res.status(400).json({ error: "請輸入有效的手機號碼" });
    }
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: "請輸入 6 位數字驗證碼" });
    }

    // ── 接入後取消以下註解 ──
    // const record = smsOtpStore.get(phone);
    // if (!record) return res.status(400).json({ error: "請先發送驗證碼" });
    // if (record.expiresAt <= Date.now()) {
    //   smsOtpStore.delete(phone);
    //   return res.status(400).json({ error: "驗證碼已過期，請重新發送" });
    // }
    // if (record.attempts >= SMS_OTP_MAX_ATTEMPTS) {
    //   smsOtpStore.delete(phone);
    //   return res.status(429).json({ error: "驗證失敗次數過多，請重新發送" });
    // }
    // record.attempts += 1;
    // if (record.code !== otp) {
    //   const remaining = SMS_OTP_MAX_ATTEMPTS - record.attempts;
    //   return res.status(400).json({ error: `驗證碼錯誤，還可嘗試 ${remaining} 次` });
    // }
    // smsOtpStore.delete(phone);
    // ... 查詢或創建用戶，創建 session，返回 { ok: true }

    return res.status(501).json({
      error: "手機簡訊登入即將開放，請使用郵箱登入",
      code: "SMS_NOT_IMPLEMENTED",
    });
  });
}
