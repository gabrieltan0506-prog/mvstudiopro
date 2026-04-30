/**
 * PDF 生成 + GCS 上传 + V4 限时签名链接。
 *
 * v5 重构（2026-04-30 hotfix）：
 *   把 puppeteer 渲染从 Fly 容器内迁出，改走 Cloud Run pdf-service。
 *
 *   原因：
 *     - 大报告（PR #332 后场景图嵌正文 + 完整推演内容，最高 200 万字符）
 *       在 Fly 容器内用 puppeteer 渲染时间常超过 60s
 *     - Fly proxy 默认 idle_timeout = 60s，超时后强制断开 connection
 *     - 前端浏览器收到 connection close → 显示 "Load failed"
 *     - 日志铁证："could not complete HTTP request to instance:
 *                 legacy hyper error: client error (SendRequest) (source: http2 error)"
 *
 *   方案：
 *     - HTML 生成在 Fly（generateHtmlTemplate，纯 JS，毫秒级）
 *     - PDF 渲染走 Cloud Run pdf-service（独立服务，60min timeout，无 Fly 60s 限制）
 *     - GCS 上传 + 签名仍在 Fly（轻活，几秒搞定）
 *     - 总耗时 7-35s，稳稳在 Fly 60s 内
 *
 *   兼容性：
 *     - 输出结构 CreatePdfResult 完全不变（前端无需修改）
 *     - 5 套模板（spring-mint / neon-tech / sunset-coral / ocean-fresh / business-bright）
 *       继续工作（generateHtmlTemplate 不变）
 *     - 封面页（cover image / title / subtitle / abstract）继续工作
 *     - HTML 内置 CONFIDENTIAL 水印（pdfTemplate.ts 第 333 / 799 行）继续显示
 *
 *   降级（已与 reviewer 确认接受）：
 *     - 失去 puppeteer 的 displayHeaderFooter（页眉 CONFIDENTIAL 横条 + 页脚页码）
 *       但 HTML 内置的水印 + 封面 CONFIDENTIAL 仍在
 *
 * 参考：项目里 downloadPlatformPdf / downloadAnalysisPdf 已经走同样的 Cloud Run 路径
 * （server/routers.ts L2481-2557），架构成熟可靠。
 */

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
  /** 模板：spring-mint（薄荷樱桃）/ neon-tech（电光霓虹）/ sunset-coral（珊瑚紫罗兰）/ ocean-fresh（海蓝柠黄）/ business-bright（商务亮） */
  style?: PdfStyle;
  /** 可选封面页：nanoImage 已生成的封面图 URL + 标题摘要 */
  cover?: PdfCover;
};

/**
 * 走 Cloud Run pdf-service 把 HTML 渲染成 PDF binary。
 *
 * Cloud Run 端实现：page.setContent(html) + page.pdf({format:"A4", printBackground:true})
 * 接口约定（与 routers.ts L2481-2557 现有 downloadPlatformPdf / downloadAnalysisPdf
 * 的调用一致，已生产验证）：
 *
 *   POST {CLOUD_RUN_PDF_URL}/generate-pdf
 *   Content-Type: application/json
 *   { "html": "<完整 HTML>", "token": "" }
 *   → 200 application/pdf binary
 *   → !2xx text/json 错误信息
 *
 * AbortController 50s 超时（Fly proxy 60s 内余 10s buffer 给 GCS 上传 + 签名）。
 */
async function renderPdfViaCloudRun(htmlContent: string): Promise<Buffer> {
  const cloudRunUrl = String(process.env.CLOUD_RUN_PDF_URL || "").trim();
  if (!cloudRunUrl) {
    throw new Error(
      "CLOUD_RUN_PDF_URL 未配置：PDF 渲染服务不可用。" +
        "请联系运维确认 Cloud Run pdf-service 已部署并设置该环境变量。",
    );
  }
  const proxyUrl = cloudRunUrl.replace(/\/$/, "") + "/generate-pdf";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 50_000);

  try {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: htmlContent, token: "" }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(
        `pdf-service returned HTTP ${res.status}: ${errBody.slice(0, 300)}`,
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    if (!buf || buf.length === 0) {
      throw new Error("pdf-service 返回空 PDF binary");
    }
    return buf;
  } finally {
    clearTimeout(timeoutId);
  }
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
  const style: PdfStyle = (opts?.style as PdfStyle) || "spring-mint";

  const htmlContent = generateHtmlTemplate(markdownContent, {
    style,
    cover: opts?.cover,
  });

  const pdfBuffer = await renderPdfViaCloudRun(htmlContent);

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
}
