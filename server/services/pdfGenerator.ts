/**
 * 容器内 Puppeteer 压 PDF + GCS 存储 + V4 限时签名下载链接。
 * 不调用任何第三方 PDF SaaS；仅使用本进程 Chromium + @google-cloud/storage。
 */

import puppeteer from "puppeteer";
import { Storage } from "@google-cloud/storage";
import { generateHtmlTemplate } from "./pdfTemplate";

function getPdfExportBucket(): string {
  return (
    String(process.env.GCS_PDF_EXPORT_BUCKET || "").trim()
    || String(process.env.GCS_USER_UPLOADS_BUCKET || "").trim()
    || "mv-studio-pro-user-uploads-255451353515"
  );
}

function getGcsStorage(): Storage {
  const raw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  if (raw) {
    const creds = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string };
    return new Storage({
      projectId: creds.project_id,
      credentials: {
        client_email: creds.client_email,
        private_key: creds.private_key,
      },
    });
  }
  return new Storage();
}

export type CreatePdfResult = {
  gcsUri: string;
  objectName: string;
  bucket: string;
  signedUrl: string;
  expiresAt: string;
};

/**
 * @param reportId 对象路径中的业务 ID（建议 nanoid / jobId）
 * @param markdownContent Deep Research / 3.1 合成产出的 Markdown
 * @param opts.signedUrlHours 签名 URL 有效期小时数，默认 72，最大 168
 */
export async function createAndUploadPdf(
  reportId: string,
  markdownContent: string,
  opts?: { signedUrlHours?: number },
): Promise<CreatePdfResult> {
  const safeId = String(reportId || "report").replace(/[^a-zA-Z0-9/_\-]/g, "-").slice(0, 120);
  const hours = Math.min(168, Math.max(1, Number(opts?.signedUrlHours) || 72));
  const expires = Date.now() + hours * 60 * 60 * 1000;

  const htmlContent = generateHtmlTemplate(markdownContent);

  const executablePath = String(process.env.PUPPETEER_EXECUTABLE_PATH || "").trim() || undefined;

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: executablePath || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--single-process",
      "--no-zygote",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 2 });
    await page.setContent(htmlContent, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    // 等本地字体与首屏布局稳定
    await new Promise((r) => setTimeout(r, 800));

    const pdfBuffer = Buffer.from(
      await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "72px", bottom: "72px", left: "36px", right: "36px" },
        displayHeaderFooter: true,
        headerTemplate: `
          <div style="font-size:9px;width:100%;padding:0 36px;display:flex;justify-content:space-between;color:#B8860B;font-family:system-ui,sans-serif;">
            <span>MV STUDIO PRO · 战略情报局</span>
            <span style="color:#8B0000;font-weight:700;">CONFIDENTIAL</span>
          </div>`,
        footerTemplate: `
          <div style="font-size:9px;width:100%;text-align:center;color:#888;font-family:system-ui,sans-serif;">
            <span class="pageNumber"></span> / <span class="totalPages"></span>
          </div>`,
      }),
    );

    const bucketName = getPdfExportBucket();
    const objectName = `strategic-reports/${safeId}.pdf`;
    const storage = getGcsStorage();
    const file = storage.bucket(bucketName).file(objectName);

    await file.save(pdfBuffer, {
      contentType: "application/pdf",
      resumable: false,
      metadata: { cacheControl: "private, max-age=0" },
    });

    const [signedUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires,
    });

    const gcsUri = `gs://${bucketName}/${objectName}`;

    return {
      gcsUri,
      objectName,
      bucket: bucketName,
      signedUrl,
      expiresAt: new Date(expires).toISOString(),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
