/**
 * 容器内 Puppeteer 压 PDF + GCS 存储 + V4 限时签名下载链接。
 * 不调用任何第三方 PDF SaaS；仅使用本进程 Chromium + @google-cloud/storage。
 *
 * v3 升级（2026-04-29）：
 *   - 接受 style 参数：'quiet-luxury' | 'watercolor' | 'business-bright' | 'business-dark'
 *   - 接受 cover 参数：可选 nanoImage URL → 注入封面页
 *   - 修 CONFIDENTIAL 头眉切残：移除 letter-spacing，margin: 0 + padding 控制
 *   - 第 1 页（封面）跳过 header / footer，封面 100% 满版
 */

import puppeteer from "puppeteer";
import { Storage } from "@google-cloud/storage";
import { generateHtmlTemplate, type PdfStyle, type PdfCover } from "./pdfTemplate";

function getPdfExportBucket(): string {
  return (
    String(process.env.GCS_PDF_EXPORT_BUCKET || "").trim() ||
    String(process.env.GCS_USER_UPLOADS_BUCKET || "").trim() ||
    "mv-studio-pro-user-uploads-255451353515"
  );
}

function getGcsStorage(): Storage {
  const raw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  if (raw) {
    const creds = JSON.parse(raw) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
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
  style: PdfStyle;
};

export type CreatePdfOpts = {
  signedUrlHours?: number;
  /** 模板：quiet-luxury（静奢白）/ watercolor（水彩薄雾）/ business-bright（商务亮）/ business-dark（商务夜） */
  style?: PdfStyle;
  /** 可选封面页：nanoImage 已生成的封面图 URL + 标题摘要 */
  cover?: PdfCover;
};

/** 头眉/页脚配色（与 v3 四套调色板对齐） */
function getHeaderFooterColors(style: PdfStyle): {
  primary: string;
  text: string;
  confidential: string;
  muted: string;
} {
  if (style === "watercolor") {
    return { primary: "#7A8C92", text: "#2B3940", confidential: "#A04C4C", muted: "#7E8A92" };
  }
  if (style === "business-bright") {
    return { primary: "#1F3A5F", text: "#0F1B2D", confidential: "#A52A2A", muted: "#55657A" };
  }
  if (style === "business-dark") {
    return { primary: "#2A2D33", text: "#1A1A1A", confidential: "#E89549", muted: "#4A4A4A" };
  }
  // quiet-luxury（默认）
  return { primary: "#8B6F3D", text: "#1A1A1A", confidential: "#A04C4C", muted: "#6B7280" };
}

/**
 * @param reportId 对象路径中的业务 ID（建议 nanoid / jobId）
 * @param markdownContent Deep Research / 3.1 合成产出的 Markdown
 * @param opts.signedUrlHours 签名 URL 有效期小时数，默认 72，最大 168
 * @param opts.style 模板风格
 * @param opts.cover 可选封面页
 */
export async function createAndUploadPdf(
  reportId: string,
  markdownContent: string,
  opts?: CreatePdfOpts,
): Promise<CreatePdfResult> {
  const safeId = String(reportId || "report")
    .replace(/[^a-zA-Z0-9/_\-]/g, "-")
    .slice(0, 120);
  const hours = Math.min(168, Math.max(1, Number(opts?.signedUrlHours) || 72));
  const expires = Date.now() + hours * 60 * 60 * 1000;
  const style: PdfStyle = (opts?.style as PdfStyle) || "quiet-luxury";
  const colors = getHeaderFooterColors(style);

  const htmlContent = generateHtmlTemplate(markdownContent, {
    style,
    cover: opts?.cover,
  });

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
      waitUntil: opts?.cover?.imageUrl ? "networkidle0" : "domcontentloaded",
      timeout: 120_000,
    });
    await new Promise((r) => setTimeout(r, 800));

    // 修 CONFIDENTIAL 切残：letter-spacing: normal + 容器无 margin、padding 控制
    const headerHtml = `
      <div style="font-size:9px;width:100%;padding:0 30px;display:flex;justify-content:space-between;align-items:center;color:${colors.text};font-family:system-ui,'Helvetica Neue','PingFang SC',sans-serif;letter-spacing:normal;box-sizing:border-box;-webkit-print-color-adjust:exact;">
        <span style="font-weight:700;"><span style="color:${colors.primary};">MV STUDIO PRO</span><span style="color:${colors.text};"> · 战略情报局</span></span>
        <span style="color:${colors.confidential};font-weight:800;letter-spacing:0.04em;">CONFIDENTIAL</span>
      </div>`;

    const footerHtml = `
      <div style="font-size:9px;width:100%;padding:0 30px;display:flex;justify-content:space-between;align-items:center;color:${colors.muted};font-family:system-ui,'Helvetica Neue','PingFang SC',sans-serif;letter-spacing:normal;box-sizing:border-box;">
        <span style="color:${colors.primary};">© ${new Date().getFullYear()} · MV STUDIO PRO</span>
        <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>`;

    const pdfBuffer = Buffer.from(
      await page.pdf({
        format: "A4",
        printBackground: true,
        // 左右 margin 收到 0，由 header 内部 padding 控制，避免 CONFIDENTIAL 切残
        margin: { top: "70px", bottom: "70px", left: "0", right: "0" },
        displayHeaderFooter: true,
        headerTemplate: headerHtml,
        footerTemplate: footerHtml,
      }),
    );

    const bucketName = getPdfExportBucket();
    const objectName = `strategic-reports/${style}/${safeId}.pdf`;
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
      style,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
