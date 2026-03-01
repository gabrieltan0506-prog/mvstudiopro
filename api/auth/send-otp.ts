import type { VercelRequest, VercelResponse } from "@vercel/node";
import tencentcloud from "tencentcloud-sdk-nodejs";
import {
  normalizeEmail,
  otpStore,
  pruneExpired,
  readBody,
  validateEmail,
} from "./state.js";

const SesClient = tencentcloud.ses.v20201002.Client;
const OTP_VALIDITY_MS = 5 * 60 * 1000;

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    pruneExpired();
    const body = readBody(req);

    const emailRaw = typeof body.email === "string" ? body.email : "";
    const email = normalizeEmail(emailRaw);

    if (!validateEmail(email)) {
      return res.status(400).json({ ok: false, error: "请输入有效的邮箱地址" });
    }

    const secretId = process.env.TENCENT_SECRET_ID;
    const secretKey = process.env.TENCENT_SECRET_KEY;
    const region = process.env.TENCENT_SES_REGION;
    const fromEmail = process.env.TENCENT_SES_FROM_EMAIL;

    if (!secretId || !secretKey || !region || !fromEmail) {
      return res.status(500).json({ ok: false, error: "邮件服务未配置" });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    otpStore.set(email, {
      code: otp,
      expiresAt: Date.now() + OTP_VALIDITY_MS,
      attempts: 0,
    });

    const client = new SesClient({
      credential: {
        secretId,
        secretKey,
      },
      region,
      profile: {
        httpProfile: {
          endpoint: "ses.tencentcloudapi.com",
        },
      },
    });

    const subject = "MV Studio Pro 登录验证码";
    const html = `<h2>MV Studio Pro 验证码</h2><p>你的验证码是：</p><h1>${otp}</h1><p>5分钟内有效</p>`;
    const text = `MV Studio Pro 验证码：${otp}，5分钟内有效。`;

    await client.SendEmail({
      FromEmailAddress: fromEmail,
      Destination: [email],
      Subject: subject,
      Simple: {
        Html: Buffer.from(html, "utf8").toString("base64"),
        Text: Buffer.from(text, "utf8").toString("base64"),
      },
    });

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    const detail = (err?.message || String(err || "")).slice(0, 200);
    return res.status(500).json({ ok: false, error: "发送失败", detail });
  }
}
