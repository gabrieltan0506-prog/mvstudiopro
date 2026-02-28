import nodemailer from "nodemailer";

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
};

function getMissingVars() {
  const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const;
  return required.filter(key => !process.env[key] || String(process.env[key]).trim().length === 0);
}

function getConfig(): SmtpConfig {
  const missing = getMissingVars();
  if (missing.length > 0) {
    throw new Error(`SMTP 配置缺失，请设置环境变量：${missing.join("、")}`);
  }

  const port = Number(process.env.SMTP_PORT);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("SMTP_PORT 配置无效，请填写正确的端口号");
  }

  return {
    host: String(process.env.SMTP_HOST),
    port,
    user: String(process.env.SMTP_USER),
    pass: String(process.env.SMTP_PASS),
    from: String(process.env.SMTP_FROM),
  };
}

export async function sendOtpMail(email: string, otp: string): Promise<void> {
  const config = getConfig();
  if (config.host === "console") {
    console.log(`[Auth API] OTP for ${email}: ${otp}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  await transporter.sendMail({
    from: config.from,
    to: email,
    subject: "MVStudioPro 登录验证码",
    text: `您的登录验证码是：${otp}。验证码 10 分钟内有效。`,
    html: `<p>您的登录验证码是：<b style=\"font-size:20px\">${otp}</b></p><p>验证码 10 分钟内有效，请勿泄露给他人。</p>`,
  });
}
