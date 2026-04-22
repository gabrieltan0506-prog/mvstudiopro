/**
 * Storyboard Export Module
 * Handles PDF and Word export for storyboard scripts.
 * PDF: Uses local/system fonts when available, with built-in PDF fallback
 * Word: Uses docx library for proper .docx generation
 * 
 * Features:
 * - Preserves original image aspect ratio in Word export
 * - Adds colored watermark for free-tier users (PDF diagonal + Word header/footer)
 */
import fs from "fs";
import path from "path";
import axios from "axios";
import sharp from "sharp";
import { get } from "@vercel/blob";
import { storagePut, storageGet } from "./storage";
import { env } from "./vercel-api-core/env";

// ─── Types ──────────────────────────────────────────────
interface StoryboardScene {
  sceneNumber: number;
  timestamp: string;
  duration: string;
  description: string;
  cameraMovement: string;
  mood: string;
  visualElements: string[];
  transition?: string;
  previewImageUrl?: string | null;
  previewImageUrls?: string[];
}

interface StoryboardData {
  title: string;
  musicInfo: {
    bpm: number;
    emotion: string;
    style: string;
    key: string;
  };
  scenes: StoryboardScene[];
  summary: string;
}

interface ExportOptions {
  addWatermark?: boolean; // Whether to add watermark (free-tier)
}

// ─── Constants ─────────────────────────────────────────
const WATERMARK_TEXT = "MV Studio Pro";
const WATERMARK_URL = "mvstudiopro.com";
const WATERMARK_COLOR_HEX = "FF6B35"; // Vibrant orange for visibility
const WATERMARK_COLOR_RGBA = "rgba(255, 107, 53, 0.52)"; // Stronger watermark overlay
const WATERMARK_COLOR_RGBA_LIGHT = "rgba(255, 107, 53, 0.28)";
const MAX_IMAGE_WIDTH = 480; // Max width in Word document (points)

function getBlobPathname(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+/, "");
  } catch {
    return String(url || "").replace(/^\/+/, "").trim();
  }
}

// ─── Font Management ────────────────────────────────────
async function ensureFonts(): Promise<{ regular: string | null; bold: string | null }> {
  const regularCandidates = [
    path.resolve(process.cwd(), "assets/fonts/NotoSansCJKsc-Regular.otf"),
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
    "/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
  ];
  const boldCandidates = [
    path.resolve(process.cwd(), "assets/fonts/NotoSansCJKsc-Bold.otf"),
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Bold.otf",
    "/usr/share/fonts/truetype/noto/NotoSansSC-Bold.ttf",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
  ];

  const regular = regularCandidates.find((fontPath) => fs.existsSync(fontPath)) ?? null;
  const bold = boldCandidates.find((fontPath) => fs.existsSync(fontPath)) ?? null;

  if (!regular || !bold) {
    console.warn("[StoryboardExport] Local CJK fonts unavailable, falling back to built-in PDF fonts.");
  }

  return { regular, bold };
}

function getSceneExportImageUrls(scene: StoryboardScene) {
  const list = Array.isArray(scene.previewImageUrls) ? scene.previewImageUrls : [];
  const normalized = list.map((value) => String(value || "").trim()).filter(Boolean);
  if (normalized.length) return normalized;
  const single = String(scene.previewImageUrl || "").trim();
  return single ? [single] : [];
}

// ─── Image Helper ──────────────────────────────────────
/**
 * Download image and get its actual dimensions for proper aspect ratio
 */
async function downloadImageWithDimensions(url: string): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
  scaledWidth: number;
  scaledHeight: number;
}> {
  const target = String(url || "").trim();
  let buffer: Buffer | null = null;
  if (/\.blob\.vercel-storage\.com\//i.test(target) && (env.mvspReadWriteToken || process.env.BLOB_READ_WRITE_TOKEN)) {
    const errors: string[] = [];
    const tokens = Array.from(
      new Set([env.mvspReadWriteToken, process.env.MVSP_READ_WRITE_TOKEN, process.env.BLOB_READ_WRITE_TOKEN].filter(Boolean)),
    ) as string[];
    for (const token of tokens) {
      try {
        const direct = await fetch(target, {
          headers: { authorization: `Bearer ${token}` },
          redirect: "follow",
        });
        if (direct.ok) {
          buffer = Buffer.from(await direct.arrayBuffer());
          break;
        } else {
          errors.push(`direct:${direct.status}`);
        }
      } catch (error: any) {
        errors.push(`direct:${error?.message || String(error)}`);
      }

      if (!buffer) {
        try {
          const byUrl = await get(target, { token, access: "public" });
          const statusCode = byUrl?.statusCode ?? 0;
          if (byUrl && statusCode === 200 && byUrl.stream) {
            buffer = Buffer.from(await new Response(byUrl.stream).arrayBuffer());
            break;
          } else {
            errors.push(`get-url:${statusCode}`);
          }
        } catch (error: any) {
          errors.push(`get-url:${error?.message || String(error)}`);
        }
      }

      if (!buffer) {
        try {
          const byPath = await get(getBlobPathname(target), { token, access: "public" });
          const statusCode = byPath?.statusCode ?? 0;
          if (byPath && statusCode === 200 && byPath.stream) {
            buffer = Buffer.from(await new Response(byPath.stream).arrayBuffer());
            break;
          } else {
            errors.push(`get-path:${statusCode}`);
          }
        } catch (error: any) {
          errors.push(`get-path:${error?.message || String(error)}`);
        }
      }
    }

    if (!buffer) {
      throw new Error(`blob_image_fetch_failed:${errors.join("|")}`);
    }
  } else {
    const response = await axios.get(target, {
      responseType: "arraybuffer",
      timeout: 15000,
    });
    buffer = Buffer.from(response.data);
  }
  
  // Use sharp to get actual image dimensions
  const finalBuffer = buffer || Buffer.alloc(0);
  const metadata = await sharp(finalBuffer).metadata();
  const origWidth = metadata.width || 1024;
  const origHeight = metadata.height || 576;
  
  // Scale to fit max width while preserving aspect ratio
  const aspectRatio = origHeight / origWidth;
  const scaledWidth = Math.min(origWidth, MAX_IMAGE_WIDTH);
  const scaledHeight = Math.round(scaledWidth * aspectRatio);
  
  return { buffer: finalBuffer, width: origWidth, height: origHeight, scaledWidth, scaledHeight };
}

/**
 * Add colored watermark overlay to an image buffer for PDF/Word export
 */
async function addExportWatermark(imageBuffer: Buffer): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 576;
  
  const fontSize = Math.max(26, Math.floor(Math.min(width, height) * 0.1));
  
  // Create diagonal repeating watermark with orange color
  const svgOverlay = `
    <svg width="${width}" height="${height}">
      <defs>
        <style>
          .wm { 
            fill: ${WATERMARK_COLOR_RGBA}; 
            font-family: Arial, sans-serif; 
            font-weight: 700; 
            letter-spacing: 3px;
          }
          .wm-sm { 
            fill: ${WATERMARK_COLOR_RGBA_LIGHT}; 
            font-family: Arial, sans-serif; 
            font-weight: 600; 
            letter-spacing: 2px;
          }
        </style>
      </defs>
      <text x="50%" y="18%" text-anchor="middle" dominant-baseline="middle" 
        class="wm-sm" font-size="${fontSize * 0.6}" 
        transform="rotate(-25, ${width / 2}, ${height * 0.18})">${WATERMARK_TEXT}</text>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" 
        class="wm" font-size="${fontSize}" 
        transform="rotate(-25, ${width / 2}, ${height / 2})">${WATERMARK_TEXT}</text>
      <text x="50%" y="82%" text-anchor="middle" dominant-baseline="middle" 
        class="wm-sm" font-size="${fontSize * 0.6}" 
        transform="rotate(-25, ${width / 2}, ${height * 0.82})">${WATERMARK_URL}</text>
      <text x="22%" y="42%" text-anchor="middle" dominant-baseline="middle" 
        class="wm-sm" font-size="${fontSize * 0.5}" 
        transform="rotate(-25, ${width * 0.22}, ${height * 0.42})">${WATERMARK_TEXT}</text>
      <text x="78%" y="58%" text-anchor="middle" dominant-baseline="middle" 
        class="wm-sm" font-size="${fontSize * 0.5}" 
        transform="rotate(-25, ${width * 0.78}, ${height * 0.58})">${WATERMARK_URL}</text>
    </svg>`;
  
  return image
    .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
    .toBuffer();
}

// ─── PDF Export ─────────────────────────────────────────
export async function exportToPDF(
  storyboard: StoryboardData,
  options: ExportOptions = {}
): Promise<{ url: string; message: string }> {
  const fonts = await ensureFonts();
  const PDFDocument = (await import("pdfkit")).default;
  const { addWatermark = false } = options;

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const fileName = `storyboard_${Date.now()}.pdf`;
  const filePath = path.join("/tmp", fileName);
  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  const pageWidth = 595.28 - 100; // A4 width minus margins
  const fontBold = (size: number) => doc.fontSize(size).font(fonts.bold ?? "Helvetica-Bold");
  const fontRegular = (size: number) => doc.fontSize(size).font(fonts.regular ?? "Helvetica");

  // Helper: Add PDF page watermark (colored diagonal text)
  const addPageWatermark = () => {
    if (!addWatermark) return;
    doc.save();
    doc.rotate(-30, { origin: [297.64, 420.94] });
    doc.fontSize(48).font("Helvetica-Bold")
      .fillColor("#FF6B35")
      .opacity(0.12)
      .text(WATERMARK_TEXT, 80, 350, { align: "center" });
    doc.fontSize(24).font("Helvetica")
      .fillColor("#FF6B35")
      .opacity(0.08)
      .text(WATERMARK_URL, 80, 410, { align: "center" });
    doc.restore();
    doc.fillColor("#000000").opacity(1); // Reset
  };

  // Title page
  addPageWatermark();
  fontBold(24).text(storyboard.title, { align: "center" });
  doc.moveDown();

  // Watermark notice for free tier
  if (addWatermark) {
    doc.moveDown();
    fontRegular(9)
      .fillColor("#FF6B35")
      .text("本文档由 MV Studio Pro 免费版生成，升级专业版可移除水印", { align: "center" });
    doc.fillColor("#000000");
    doc.moveDown();
  }

  // Music Info
  fontBold(14).text("音樂信息", { underline: true });
  fontRegular(12);
  doc.text(`BPM: ${storyboard.musicInfo.bpm}`);
  doc.text(`情感基調: ${storyboard.musicInfo.emotion}`);
  doc.text(`音樂風格: ${storyboard.musicInfo.style}`);
  doc.text(`調性: ${storyboard.musicInfo.key}`);
  doc.moveDown();

  // Scenes
  for (const scene of storyboard.scenes) {
    doc.addPage();
    addPageWatermark();

    fontBold(18).text(`场景 ${scene.sceneNumber}`, { underline: true });
    fontRegular(12).text(`${scene.timestamp} (${scene.duration})`);
    doc.moveDown();

    // Preview image with watermark
    const previewImageUrls = getSceneExportImageUrls(scene);
    for (const previewImageUrl of previewImageUrls) {
      try {
        const imgData = await downloadImageWithDimensions(previewImageUrl);
        let imageBuffer = imgData.buffer;

        if (addWatermark) {
          imageBuffer = await addExportWatermark(imageBuffer);
        }

        const pdfMaxWidth = Math.min(pageWidth, 500);
        const aspectRatio = imgData.height / imgData.width;
        const pdfHeight = Math.round(pdfMaxWidth * aspectRatio);

        doc.image(imageBuffer, {
          fit: [pdfMaxWidth, Math.min(pdfHeight, 350)],
          align: "center",
        });
        doc.moveDown();
      } catch (error) {
        console.error(`Failed to load image for scene ${scene.sceneNumber}:`, error);
        fontRegular(10).text("[图片加載失敗]", { align: "center" });
        doc.moveDown();
      }
    }

    fontBold(14).text("场景描述:");
    fontRegular(11).text(scene.description);
    doc.moveDown();

    fontBold(14).text("镜头运动:");
    fontRegular(11).text(scene.cameraMovement);
    doc.moveDown();

    fontBold(14).text("情緒氛圍:");
    fontRegular(11).text(scene.mood);
    doc.moveDown();

    fontBold(14).text("视觉元素:");
    fontRegular(11).text(scene.visualElements.join("、"));
    doc.moveDown();

    if (scene.transition) {
      fontBold(14).text("转场建议:");
      fontRegular(11).text(scene.transition);
      doc.moveDown();
    }
  }

  // Summary
  doc.addPage();
  addPageWatermark();
  fontBold(18).text("整体建议", { underline: true });
  doc.moveDown();
  fontRegular(11).text(storyboard.summary);

  doc.end();

  await new Promise<void>((resolve, reject) => {
    writeStream.on("finish", () => resolve());
    writeStream.on("error", reject);
  });

  const pdfBuffer = fs.readFileSync(filePath);
  fs.unlinkSync(filePath);
  try {
    const { key: pdfKey } = await storagePut(fileName, pdfBuffer, "application/pdf");
    const { url: pdfDownloadUrl } = await storageGet(pdfKey);
    console.log("[StoryboardExport] PDF generated:", { key: pdfKey, url: pdfDownloadUrl, watermark: addWatermark });
    return { url: pdfDownloadUrl, message: addWatermark ? "PDF 已生成（含水印）！升级专业版可移除水印。" : "PDF 已生成！" };
  } catch (error) {
    console.warn("[StoryboardExport] PDF fallback to data URL:", error);
    return {
      url: `data:application/pdf;base64,${pdfBuffer.toString("base64")}`,
      message: addWatermark ? "PDF 已生成（含水印）！升级专业版可移除水印。" : "PDF 已生成！",
    };
  }
}

export async function exportSnapshotImageToPDF(input: {
  title: string;
  imageDataUrl: string;
}): Promise<{ url: string; message: string; buffer: Buffer }> {
  const PDFDocument = (await import("pdfkit")).default;
  const title = String(input.title || "").trim() || "MV Analysis Export";
  const imageDataUrl = String(input.imageDataUrl || "").trim();
  if (!imageDataUrl.startsWith("data:image/")) {
    throw new Error("invalid_image_data");
  }

  const base64 = imageDataUrl.split(",")[1] || "";
  if (!base64) throw new Error("missing_image_payload");
  const imageBuffer = Buffer.from(base64, "base64");
  const normalizedImageBuffer = await sharp(imageBuffer)
    .flatten({ background: "#0b1020" })
    .jpeg({ quality: 92 })
    .toBuffer();
  const metadata = await sharp(normalizedImageBuffer).metadata();
  const width = metadata.width || 1600;
  const height = metadata.height || 900;

  const fileName = `mv_analysis_${Date.now()}.pdf`;
  const filePath = path.join("/tmp", fileName);
  const doc = new PDFDocument({ size: "A4", margin: 24 });
  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  doc.fontSize(16).font("Helvetica-Bold").text(title, { align: "center" });
  doc.moveDown(0.8);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const pageHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom - 40;
  const aspectRatio = height / width;
  const targetWidth = pageWidth;
  const targetHeight = Math.min(pageHeight, targetWidth * aspectRatio);

  doc.image(normalizedImageBuffer, doc.page.margins.left, doc.y, {
    fit: [pageWidth, targetHeight],
    align: "center",
  });

  doc.end();

  await new Promise<void>((resolve, reject) => {
    writeStream.on("finish", () => resolve());
    writeStream.on("error", reject);
  });

  const pdfBuffer = fs.readFileSync(filePath);
  fs.unlinkSync(filePath);
  try {
    const { key } = await storagePut(fileName, pdfBuffer, "application/pdf");
    const { url } = await storageGet(key);
    return { url, message: "PDF 已生成！", buffer: pdfBuffer };
  } catch {
    return {
      url: `data:application/pdf;base64,${pdfBuffer.toString("base64")}`,
      message: "PDF 已生成！",
      buffer: pdfBuffer,
    };
  }
}

// ─── Word Export ────────────────────────────────────────
export async function exportToWord(
  storyboard: StoryboardData,
  options: ExportOptions = {}
): Promise<{ url: string; message: string }> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    ImageRun,
    Header,
    Footer,
  } = await import("docx");

  const { addWatermark = false } = options;
  const children: any[] = [];

  // Title
  children.push(
    new Paragraph({
      text: storyboard.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    })
  );

  // Watermark notice for free tier
  if (addWatermark) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "⚠ 本文档由 MV Studio Pro 免费版生成，升级专业版可移除水印",
            size: 18,
            color: WATERMARK_COLOR_HEX,
            italics: true,
            font: "Microsoft YaHei",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      })
    );
  }

  // Music Info
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: "音樂信息", bold: true, size: 28, font: "Microsoft YaHei" }),
      ],
      spacing: { before: 200, after: 100 },
    })
  );

  const musicInfoItems = [
    `BPM: ${storyboard.musicInfo.bpm}`,
    `情感基調: ${storyboard.musicInfo.emotion}`,
    `音樂風格: ${storyboard.musicInfo.style}`,
    `調性: ${storyboard.musicInfo.key}`,
  ];
  for (const item of musicInfoItems) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: item, size: 22, font: "Microsoft YaHei" })],
        spacing: { after: 60 },
      })
    );
  }

  // Scenes
  for (const scene of storyboard.scenes) {
    // Scene heading
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `场景 ${scene.sceneNumber}`,
            bold: true,
            size: 32,
            font: "Microsoft YaHei",
          }),
          new TextRun({
            text: `  ${scene.timestamp} (${scene.duration})`,
            size: 22,
            color: "888888",
            font: "Microsoft YaHei",
          }),
        ],
        spacing: { before: 400, after: 200 },
      })
    );

    // Preview image - FIXED: preserve aspect ratio
    const previewImageUrls = getSceneExportImageUrls(scene);
    for (const previewImageUrl of previewImageUrls) {
      try {
        const imgData = await downloadImageWithDimensions(previewImageUrl);
        let imageBuffer = imgData.buffer;

        if (addWatermark) {
          imageBuffer = await addExportWatermark(imageBuffer);
        }

        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: imageBuffer,
                transformation: {
                  width: imgData.scaledWidth,
                  height: imgData.scaledHeight,
                },
                type: "png",
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          })
        );
      } catch (error) {
        console.error(`[Word] Failed to load image for scene ${scene.sceneNumber}:`, error);
        children.push(
          new Paragraph({
            children: [new TextRun({ text: "[图片加載失敗]", italics: true, color: "999999", font: "Microsoft YaHei" })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          })
        );
      }
    }

    // Scene details
    const details = [
      { label: "场景描述", value: scene.description },
      { label: "镜头运动", value: scene.cameraMovement },
      { label: "情緒氛圍", value: scene.mood },
      { label: "视觉元素", value: scene.visualElements.join("、") },
    ];

    if (scene.transition) {
      details.push({ label: "转场建议", value: scene.transition });
    }

    for (const detail of details) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${detail.label}: `, bold: true, size: 22, font: "Microsoft YaHei" }),
            new TextRun({ text: detail.value, size: 22, font: "Microsoft YaHei" }),
          ],
          spacing: { after: 80 },
        })
      );
    }
  }

  // Summary
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: "整体建议", bold: true, size: 32, font: "Microsoft YaHei" }),
      ],
      spacing: { before: 400, after: 200 },
    })
  );
  children.push(
    new Paragraph({
      children: [new TextRun({ text: storyboard.summary, size: 22, font: "Microsoft YaHei" })],
      spacing: { after: 200 },
    })
  );

  // Build document with optional watermark header/footer
  const headerChildren = addWatermark
    ? [
        new Paragraph({
          children: [
            new TextRun({
              text: `${WATERMARK_TEXT} | ${WATERMARK_URL} | 免费版 — 升级专业版移除水印`,
              size: 16,
              color: WATERMARK_COLOR_HEX,
              italics: true,
              font: "Arial",
            }),
          ],
          alignment: AlignmentType.CENTER,
        }),
      ]
    : [];

  const footerChildren = addWatermark
    ? [
        new Paragraph({
          children: [
            new TextRun({
              text: `© ${WATERMARK_TEXT} — ${WATERMARK_URL} | 本文档含水印，升级专业版可移除`,
              size: 14,
              color: WATERMARK_COLOR_HEX,
              italics: true,
              font: "Arial",
            }),
          ],
          alignment: AlignmentType.CENTER,
        }),
      ]
    : [];

  const sectionConfig: any = {
    properties: {},
    children,
  };

  if (addWatermark) {
    sectionConfig.headers = {
      default: new Header({ children: headerChildren }),
    };
    sectionConfig.footers = {
      default: new Footer({ children: footerChildren }),
    };
  }

  const doc = new Document({
    sections: [sectionConfig],
  });

  const buffer = await Packer.toBuffer(doc);
  const wordFileName = `storyboard_${Date.now()}.docx`;
  try {
    const { key: wordKey } = await storagePut(wordFileName, buffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const { url: wordDownloadUrl } = await storageGet(wordKey);
    console.log("[StoryboardExport] Word generated:", { key: wordKey, url: wordDownloadUrl, watermark: addWatermark });
    return { url: wordDownloadUrl, message: addWatermark ? "Word 文檔已生成（含水印）！升級專业版可移除水印。" : "Word 文檔已生成！" };
  } catch (error) {
    console.warn("[StoryboardExport] Word fallback to data URL:", error);
    return {
      url: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${buffer.toString("base64")}`,
      message: addWatermark ? "Word 文檔已生成（含水印）！升級專业版可移除水印。" : "Word 文檔已生成！",
    };
  }
}
