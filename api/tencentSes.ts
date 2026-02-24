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

  await client.SendEmail({
    FromEmailAddress: fromEmail,
    Destination: [to],
    Subject: "MVStudioPro Tencent SES Test Email",
    Simple: {
      Text: "This is a test email sent via Tencent SES.",
      Html: "<p>This is a test email sent via Tencent SES.</p>",
    },
  });
}
