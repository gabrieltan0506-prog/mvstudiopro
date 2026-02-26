import tencentcloud from "tencentcloud-sdk-nodejs";

const SesClient = tencentcloud.ses.v20201002.Client;

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

export async function sendTencentSesOtpEmail(to: string, otp: string, expireMinutes: number): Promise<void> {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  const region = process.env.TENCENT_SES_REGION;
  const fromEmail = process.env.TENCENT_SES_FROM_EMAIL;

  if (!secretId || !secretKey || !region || !fromEmail) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Email OTP][DEV] ${to} -> ${otp} (expires in ${expireMinutes} minutes)`);
      return;
    }
    throw new Error("Tencent SES is not fully configured");
  }

  const client = new SesClient({
    credential: { secretId, secretKey },
    region,
    profile: {
      httpProfile: {
        endpoint: "ses.tencentcloudapi.com",
      },
    },
  });

  const subject = "MVStudioPro Email Verification Code";
  const text = `Your verification code is ${otp}. It expires in ${expireMinutes} minutes.`;
  const html = `<p>Your verification code is <strong>${otp}</strong>.</p><p>It expires in ${expireMinutes} minutes.</p>`;

  await client.SendEmail({
    FromEmailAddress: fromEmail,
    Destination: [to],
    Subject: subject,
    Simple: {
      Html: Buffer.from(html, "utf8").toString("base64"),
      Text: Buffer.from(text, "utf8").toString("base64"),
    },
  });
}
