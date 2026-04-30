/**
 * 容器内 Puppeteer 压 PDF + GCS 存储 + V4 限时签名下载链接。
 * 不调用任何第三方 PDF SaaS；仅使用本进程 Chromium + @google-cloud/storage。
 *
 * v4 升级（2026-04-29）：
 *   - 接受 style 参数：'spring-mint' | 'neon-tech' | 'sunset-coral' | 'ocean-fresh' | 'business-bright'
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
  /** 模板：spring-mint（薄荷樱桃）/ neon-tech（电光霓虹）/ sunset-coral（珊瑚紫罗兰）/ ocean-fresh（海蓝柠黄）/ business-bright（商务亮） */
  style?: PdfStyle;
  /** 可选封面页：nanoImage 已生成的封面图 URL + 标题摘要 */
  cover?: PdfCover;
  /** 强制浏览器下载用的文件名（中文 OK，会自动 RFC5987 编码）；不传则用 objectName */
  downloadFilename?: string;
};

/** 头眉/页脚配色（与 v4 五套调色板对齐） */
function getHeaderFooterColors(style: PdfStyle): {
  primary: string;
  text: string;
  confidential: string;
  muted: string;
} {
  if (style === "spring-mint") {
    return { primary: "#10B981", text: "#0F172A", confidential: "#E11D48", muted: "#64748B" };
  }
  if (style === "neon-tech") {
    return { primary: "#7C3AED", text: "#1E1B4B", confidential: "#F472B6", muted: "#6B7280" };
  }
  if (style === "sunset-coral") {
    return { primary: "#8B5CF6", text: "#3C1361", confidential: "#9F1239", muted: "#7C5C8B" };
  }
  if (style === "ocean-fresh") {
    return { primary: "#2563EB", text: "#0C1A3D", confidential: "#B91C1C", muted: "#475569" };
  }
  // business-bright（默认 fallback）
  return { primary: "#1F3A5F", text: "#0F1B2D", confidential: "#A52A2A", muted: "#55657A" };
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
  const colors = getHeaderFooterColors(style);

  // 封面图预下载转 base64 内嵌：fly logs 已证实远程 GCS URL 让 puppeteer
  // setContent 的 networkidle0 在 120s 内来不及（容器→GCS 慢网），超时后
  // chrome 把部分 paint 状态硬压成 PDF（封面叠正文 + 中间空白 + 后半截断）。
  // 预下载后 HTML 里没有任何外链，networkidle0 立刻满足。
  let coverWithLocalImage = opts?.cover;
  if (opts?.cover?.imageUrl && /^https?:\/\//.test(opts.cover.imageUrl)) {
    try {
      const res = await fetch(opts.cover.imageUrl, {
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const ct = res.headers.get("content-type") || "image/jpeg";
        const dataUri = `data:${ct};base64,${buf.toString("base64")}`;
        coverWithLocalImage = { ...opts.cover, imageUrl: dataUri };
        console.log(`[createAndUploadPdf] cover image inlined (${buf.length} bytes)`);
      } else {
        console.warn(`[createAndUploadPdf] cover prefetch failed: HTTP ${res.status}`);
      }
    } catch (e: any) {
      console.warn(`[createAndUploadPdf] cover prefetch error: ${e?.message}`);
      // 失败兜底：不 throw，让 puppeteer 继续尝试用原 URL
    }
  }

  const htmlContent = generateHtmlTemplate(markdownContent, {
    style,
    cover: coverWithLocalImage,
  });

  // 诊断日志（临时）：用 stderr + [PDFDIAG] 独特前缀，避开 ECharts SSR 噪音
  const diag = (msg: string) =>
    process.stderr.write(`[PDFDIAG] ${new Date().toISOString()} ${msg}\n`);
  const tStart = Date.now();
  const coverImgLen = coverWithLocalImage?.imageUrl?.length || 0;
  const coverImgType = !coverWithLocalImage?.imageUrl
    ? "none"
    : coverWithLocalImage.imageUrl.startsWith("data:")
    ? "data-uri"
    : coverWithLocalImage.imageUrl.startsWith("http")
    ? "http-url"
    : "other";
  diag(`begin reportId=${safeId} style=${style} mdLen=${markdownContent.length} htmlLen=${htmlContent.length} coverLen=${coverImgLen} coverType=${coverImgType}`);

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
    diag(`+${Date.now() - tStart}ms setContent done`);
    // 等 webfont 真的把字形画完，避免封面/标题段还在 fallback 字体时就 paint 成 PDF
    await page.evaluateHandle("document.fonts.ready");
    diag(`+${Date.now() - tStart}ms fonts.ready done`);
    // 让 ECharts SSR SVG / 章节卡片排版稳定（800ms 在 spring-mint 长报告里有时不够）
    await new Promise((r) => setTimeout(r, 2000));
    diag(`+${Date.now() - tStart}ms hard wait done`);

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
    diag(`+${Date.now() - tStart}ms page.pdf done bufSize=${pdfBuffer.length}`);

    const bucketName = getPdfExportBucket();
    const objectName = `strategic-reports/${style}/${safeId}.pdf`;
    const storage = getGcsStorage();
    const file = storage.bucket(bucketName).file(objectName);

    // 构造 Content-Disposition：写到对象 metadata 上后，GCS 永远会在 GET 响应里
    // 返回这个头，浏览器一定触发下载（比 v4 signed URL 的 responseDisposition 参数更可靠）。
    // RFC 5987 双 filename：ASCII 兜底 + UTF-8 中文名
    // 用 Array.from 处理 emoji / surrogate pair，避免 .slice 切坏字符
    const fallbackBase = safeId.split("/").pop() || "report";
    const rawName = String(opts?.downloadFilename || `${fallbackBase}.pdf`).trim();
    const utf8Name = rawName.toLowerCase().endsWith(".pdf") ? rawName : `${rawName}.pdf`;
    const asciiName = (Array.from(utf8Name).map((c) => (c.charCodeAt(0) <= 0x7E ? c : "_")).join("") || "report.pdf").replace(/"/g, "");
    const contentDisposition =
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`;

    await file.save(pdfBuffer, {
      contentType: "application/pdf",
      resumable: false,
      metadata: {
        cacheControl: "private, max-age=0",
        contentDisposition,
      },
    });
    diag(`+${Date.now() - tStart}ms gcs.save done`);

    // 双保险：v4 signed URL 也带上 responseDisposition；万一对象 metadata 这条路径
    // 在某些边缘场景失效，签名 URL 自身的查询参数会兜住
    const [signedUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires,
      responseDisposition: contentDisposition,
    });
    diag(`+${Date.now() - tStart}ms gcs.signedUrl done totalElapsed=${Date.now() - tStart}ms`);

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
