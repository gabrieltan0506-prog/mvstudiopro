import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true });
  }

  try {
    const { email } = req.body || {};

    if (!email) {
      return res.status(400).json({ ok: false, error: "缺少邮箱" });
    }

    // ⚠️ 临时关闭 captcha 校验
    // 直接返回成功（测试模式）

    return res.status(200).json({
      ok: true,
      message: "OTP 测试模式：已跳过验证码校验"
    });

  } catch (err: any) {
    return res.status(200).json({
      ok: false,
      error: "send-otp 崩溃",
      detail: String(err?.message || err)
    });
  }
}
