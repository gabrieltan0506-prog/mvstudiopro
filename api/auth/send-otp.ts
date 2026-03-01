import type { VercelRequest, VercelResponse } from "@vercel/node";
import { json, readJsonBody } from "./state.js";

// NOTE: 测试期：跳过图形验证码校验（Serverless 无状态会导致 captchaId 失效）
// 仅保留基本入参校验 + 发信逻辑。后续要正式版再改为 DB/Redis 存 captcha。
async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

  const body = await readJsonBody(req);
  const email = (body?.email || "").trim();

  if (!email) return json(res, 400, { ok: false, error: "邮箱不能为空" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { ok: false, error: "邮箱格式不正确" });

  // Tencent SES envs
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  const region = process.env.TENCENT_SES_REGION;
  const fromEmail = process.env.TENCENT_SES_FROM_EMAIL;
  const templateId = process.env.TENCENT_SES_TEMPLATE_ID;

  if (!secretId || !secretKey || !region || !fromEmail || !templateId) {
    return json(res, 500, { ok: false, error: "邮件服务未配置" });
  }

  // Generate OTP + store (in-memory for now; verify-otp 也已是 serverless 单文件存储)
  const { putOtpForEmail, genOtp } = await import("./state.js");
  const otp = genOtp(6);
  putOtpForEmail(email, otp);

  try {
    // Reuse existing Tencent SES API function if present
    const mod = await import("../tencentSes.js");
    if (typeof mod.sendSesOtp !== "function") {
      return json(res, 500, { ok: false, error: "发送失败", detail: "sendSesOtp not found" });
    }

    await mod.sendSesOtp({
      toEmail: email,
      fromEmail,
      templateId,
      region,
      secretId,
      secretKey,
      otp,
    });

    return json(res, 200, { ok: true });
  } catch (err: any) {
    const msg = (err?.message || String(err || "")).slice(0, 200);
    return json(res, 500, { ok: false, error: "发送失败", detail: msg });
  }
}

export default handler;
