import tencentcloud from "tencentcloud-sdk-nodejs";

const SesClient = tencentcloud.ses.v20201002.Client;

export function hasTencentSesConfig(): boolean {
  return Boolean(
    process.env.TENCENT_SECRET_ID &&
      process.env.TENCENT_SECRET_KEY &&
      process.env.TENCENT_SES_REGION &&
      process.env.TENCENT_SES_FROM_EMAIL
  );
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function sendTencentSesTestEmail(to: string): Promise<void> {
  const secretId = getRequiredEnv("TENCENT_SECRET_ID");
  const secretKey = getRequiredEnv("TENCENT_SECRET_KEY");
  const region = getRequiredEnv("TENCENT_SES_REGION");
  const fromEmail = getRequiredEnv("TENCENT_SES_FROM_EMAIL");

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

  const subject = "MVStudioPro Tencent SES Test Email";
  const text = "This is a test email sent via Tencent SES.";
  const html = "<p>This is a test email sent via Tencent SES.</p>";
  const textBase64 = Buffer.from(text, "utf8").toString("base64");
  const htmlBase64 = Buffer.from(html, "utf8").toString("base64");

  const params = {
    FromEmailAddress: fromEmail,
    Destination: [to],
    Subject: subject,
    Simple: {
      Html: htmlBase64,
      Text: textBase64,
    },
  };

  await client.SendEmail(params);
}

export async function sendTencentSesOtpEmail(to: string, otp: string): Promise<void> {
  const secretId = getRequiredEnv("TENCENT_SECRET_ID");
  const secretKey = getRequiredEnv("TENCENT_SECRET_KEY");
  const region = getRequiredEnv("TENCENT_SES_REGION");
  const fromEmail = getRequiredEnv("TENCENT_SES_FROM_EMAIL");

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

  const subject = "MVStudioPro 登录验证码";
  const text = `您的登录验证码是：${otp}。验证码 10 分钟内有效。`;
  const html = `<p>您的登录验证码是：<b style=\"font-size:20px\">${otp}</b></p><p>验证码 10 分钟内有效，请勿泄露给他人。</p>`;
  const textBase64 = Buffer.from(text, "utf8").toString("base64");
  const htmlBase64 = Buffer.from(html, "utf8").toString("base64");

  const params = {
    FromEmailAddress: fromEmail,
    Destination: [to],
    Subject: subject,
    Simple: {
      Html: htmlBase64,
      Text: textBase64,
    },
  };

  await client.SendEmail(params);
}
