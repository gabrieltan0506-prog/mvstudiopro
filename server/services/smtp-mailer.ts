import nodemailer from "nodemailer";

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  provider: "smtp" | "resend";
};

function getMissingVars() {
  const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const;
  return required.filter(key => !process.env[key] || String(process.env[key]).trim().length === 0);
}

function getResendMissingVars() {
  const required = ["RESEND_API_KEY", "RESEND_FROM"] as const;
  return required.filter(key => !process.env[key] || String(process.env[key]).trim().length === 0);
}

export function getSmtpStatus() {
  const resendMissing = getResendMissingVars();
  if (resendMissing.length === 0) {
    return {
      configured: true,
      provider: "resend" as const,
      missing: [] as string[],
      from: String(process.env.RESEND_FROM || "").trim() || undefined,
      host: "smtp.resend.com",
      port: String(process.env.RESEND_PORT || "465"),
    };
  }

  const missing = getMissingVars();
  return {
    configured: missing.length === 0,
    provider: "smtp" as const,
    missing,
    from: String(process.env.SMTP_FROM || "").trim() || undefined,
    host: String(process.env.SMTP_HOST || "").trim() || undefined,
    port: String(process.env.SMTP_PORT || "").trim() || undefined,
  };
}

function getConfig(options?: { requireResend?: boolean }): SmtpConfig {
  const resendMissing = getResendMissingVars();
  if (resendMissing.length === 0) {
    return {
      host: "smtp.resend.com",
      port: Number(process.env.RESEND_PORT || 465),
      user: "resend",
      pass: String(process.env.RESEND_API_KEY),
      from: String(process.env.RESEND_FROM),
      provider: "resend",
    };
  }

  if (options?.requireResend) {
    throw new Error(`邮件配置缺失，当前任务要求使用 Resend。当前缺少：${resendMissing.join("、")}`);
  }

  const missing = getMissingVars();
  if (missing.length > 0) {
    throw new Error(`邮件配置缺失，请设置 SMTP 或 Resend 环境变量。当前缺少：${missing.join("、")}`);
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
    provider: "smtp",
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

export async function sendMailWithAttachments(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  requireResend?: boolean;
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: string | Buffer;
    contentType?: string;
  }>;
}): Promise<void> {
  const config = getConfig({ requireResend: params.requireResend });
  if (config.host === "console") {
    console.log(`[Mail] to=${params.to} subject=${params.subject}`);
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
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
    attachments: params.attachments,
  });
}
