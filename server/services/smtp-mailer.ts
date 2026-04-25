import nodemailer from "nodemailer";
import { Resend } from "resend";

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  provider: "smtp" | "resend";
};

const MAIL_CONNECTION_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.MAIL_CONNECTION_TIMEOUT_MS || 15_000) || 15_000,
);
const MAIL_GREETING_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.MAIL_GREETING_TIMEOUT_MS || 10_000) || 10_000,
);
const MAIL_SOCKET_TIMEOUT_MS = Math.max(
  10_000,
  Number(process.env.MAIL_SOCKET_TIMEOUT_MS || 20_000) || 20_000,
);

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

function createTransport(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    connectionTimeout: MAIL_CONNECTION_TIMEOUT_MS,
    greetingTimeout: MAIL_GREETING_TIMEOUT_MS,
    socketTimeout: MAIL_SOCKET_TIMEOUT_MS,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });
}

async function sendViaResendHttp(params: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{ filename: string; content?: string | Buffer; contentType?: string }>;
}): Promise<void> {
  const apiKey = String(process.env.RESEND_API_KEY || "");
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: params.from,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
    attachments: params.attachments?.map(a => ({
      filename: a.filename,
      content: a.content instanceof Buffer ? a.content : (a.content ? Buffer.from(a.content) : undefined),
    })),
  });
  if (error) throw new Error(`Resend API error: ${error.message}`);
}

export async function sendSimpleMail(params: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
    await sendViaResendHttp({ from: String(process.env.RESEND_FROM), ...params });
    return;
  }
  const config = getConfig();
  if (config.host === "console") { console.log(`[mail] to=${params.to} subject=${params.subject}`); return; }
  const transporter = createTransport(config);
  await transporter.sendMail({ from: config.from, ...params });
}

export async function sendOtpMail(email: string, otp: string): Promise<void> {
  // 優先使用 Resend HTTP API（不受 SMTP 端口封鎖影響）
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
    const from = String(process.env.RESEND_FROM);
    console.info(`[mail.otp] resend-http to=${email}`);
    await sendViaResendHttp({
      from,
      to: email,
      subject: "MVStudioPro 登入驗證碼",
      text: `您的登入驗證碼是：${otp}。驗證碼 10 分鐘內有效。`,
      html: `<p>您的登入驗證碼是：<b style="font-size:20px">${otp}</b></p><p>驗證碼 10 分鐘內有效，請勿泄露給他人。</p>`,
    });
    return;
  }

  const config = getConfig();
  if (config.host === "console") {
    console.log(`[Auth API] OTP for ${email}: ${otp}`);
    return;
  }

  const transporter = createTransport(config);
  await transporter.sendMail({
    from: config.from,
    to: email,
    subject: "MVStudioPro 登入驗證碼",
    text: `您的登入驗證碼是：${otp}。驗證碼 10 分鐘內有效。`,
    html: `<p>您的登入驗證碼是：<b style="font-size:20px">${otp}</b></p><p>驗證碼 10 分鐘內有效，請勿泄露給他人。</p>`,
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
  const attachmentCount = params.attachments?.length || 0;

  // 優先使用 Resend HTTP API
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
    const from = String(process.env.RESEND_FROM);
    console.info(`[mail.send] resend-http to=${params.to} attachments=${attachmentCount} subject=${params.subject}`);
    try {
      await sendViaResendHttp({
        from,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
        attachments: params.attachments,
      });
      console.info(`[mail.send] success resend-http to=${params.to}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[mail.send] failed resend-http to=${params.to}: ${message}`);
      throw error;
    }
    return;
  }

  const config = getConfig({ requireResend: params.requireResend });
  if (config.host === "console") {
    console.log(`[Mail] to=${params.to} subject=${params.subject}`);
    return;
  }

  const transporter = createTransport(config);
  console.info(
    `[mail.send] provider=${config.provider} host=${config.host} to=${params.to} attachments=${attachmentCount} subject=${params.subject}`,
  );

  try {
    await transporter.sendMail({
      from: config.from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
      attachments: params.attachments,
    });
    console.info(
      `[mail.send] success provider=${config.provider} to=${params.to} attachments=${attachmentCount} subject=${params.subject}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[mail.send] failed provider=${config.provider} host=${config.host} to=${params.to} attachments=${attachmentCount} subject=${params.subject}: ${message}`,
    );
    throw error;
  }
}
