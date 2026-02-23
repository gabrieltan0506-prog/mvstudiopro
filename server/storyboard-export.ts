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
import { storagePut, storageGet } from "./storage";

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
const WATERMARK_COLOR_RGBA = "rgba(255, 107, 53, 0.35)"; // Semi-transparent orange
const WATERMARK_COLOR_RGBA_LIGHT = "rgba(255, 107, 53, 0.18)";
const MAX_IMAGE_WIDTH = 480; // Max width in Word document (points)

// ─── Font Management ────────────────────────────────────
async function ensureFonts(): Promise<{ regular: string | null; bold: string | null }> {
  const regularCandidates = [
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
    "/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf",
  ];
  const boldCandidates = [
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Bold.otf",
    "/usr/share/fonts/truetype/noto/NotoSansSC-Bold.ttf",
  ];

  const regular = regularCandidates.find((fontPath) => fs.existsSync(fontPath)) ?? null;
  const bold = boldCandidates.find((fontPath) => fs.existsSync(fontPath)) ?? null;

  if (!regular || !bold) {
    console.warn("[StoryboardExport] Local CJK fonts unavailable, falling back to built-in PDF fonts.");
  }

  return { regular, bold };
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
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15000,
  });
  const buffer = Buffer.from(response.data);
  
  // Use sharp to get actual image dimensions
  const metadata = await sharp(buffer).metadata();
  const origWidth = metadata.width || 1024;
  const origHeight = metadata.height || 576;
  
  // Scale to fit max width while preserving aspect ratio
  const aspectRatio = origHeight / origWidth;
  const scaledWidth = Math.min(origWidth, MAX_IMAGE_WIDTH);
  const scaledHeight = Math.round(scaledWidth * aspectRatio);
  
  return { buffer, width: origWidth, height: origHeight, scaledWidth, scaledHeight };
}

/**
 * Add colored watermark overlay to an image buffer for PDF/Word export
 */
async function addExportWatermark(imageBuffer: Buffer): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 576;
  
  const fontSize = Math.max(18, Math.floor(Math.min(width, height) * 0.07));
  
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
      <text x="50%" y="25%" text-anchor="middle" dominant-baseline="middle" 
        class="wm-sm" font-size="${fontSize * 0.6}" 
        transform="rotate(-25, ${width / 2}, ${height * 0.25})">${WATERMARK_TEXT}</text>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" 
        class="wm" font-size="${fontSize}" 
        transform="rotate(-25, ${width / 2}, ${height / 2})">${WATERMARK_TEXT}</text>
      <text x="50%" y="75%" text-anchor="middle" dominant-baseline="middle" 
        class="wm-sm" font-size="${fontSize * 0.6}" 
        transform="rotate(-25, ${width / 2}, ${height * 0.75})">${WATERMARK_URL}</text>
      <text x="20%" y="40%" text-anchor="middle" dominant-baseline="middle" 
        class="wm-sm" font-size="${fontSize * 0.5}" 
        transform="rotate(-25, ${width * 0.2}, ${height * 0.4})">${WATERMARK_URL}</text>
      <text x="80%" y="60%" text-anchor="middle" dominant-baseline="middle" 
        class="wm-sm" font-size="${fontSize * 0.5}" 
        transform="rotate(-25, ${width * 0.8}, ${height * 0.6})">${WATERMARK_URL}</text>
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
      .text("本文檔由 MV Studio Pro 免費版生成，升級專業版可移除水印", { align: "center" });
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

    fontBold(18).text(`場景 ${scene.sceneNumber}`, { underline: true });
    fontRegular(12).text(`${scene.timestamp} (${scene.duration})`);
    doc.moveDown();

    // Preview image with watermark
    if (scene.previewImageUrl) {
      try {
        const imgData = await downloadImageWithDimensions(scene.previewImageUrl);
        let imageBuffer = imgData.buffer;
        
        // Add watermark to image if free tier
        if (addWatermark) {
          imageBuffer = await addExportWatermark(imageBuffer);
        }
        
        // Use actual aspect ratio for PDF
        const pdfMaxWidth = Math.min(pageWidth, 500);
        const aspectRatio = imgData.height / imgData.width;
        const pdfHeight = Math.round(pdfMaxWidth * aspectRatio);
        
        doc.image(imageBuffer, { 
          fit: [pdfMaxWidth, Math.min(pdfHeight, 350)], 
          align: "center" 
        });
        doc.moveDown();
      } catch (error) {
        console.error(`Failed to load image for scene ${scene.sceneNumber}:`, error);
        fontRegular(10).text("[圖片加載失敗]", { align: "center" });
        doc.moveDown();
      }
    }

    fontBold(14).text("場景描述:");
    fontRegular(11).text(scene.description);
    doc.moveDown();

    fontBold(14).text("鏡頭運動:");
    fontRegular(11).text(scene.cameraMovement);
    doc.moveDown();

    fontBold(14).text("情緒氛圍:");
    fontRegular(11).text(scene.mood);
    doc.moveDown();

    fontBold(14).text("視覺元素:");
    fontRegular(11).text(scene.visualElements.join("、"));
    doc.moveDown();

    if (scene.transition) {
      fontBold(14).text("轉場建議:");
      fontRegular(11).text(scene.transition);
      doc.moveDown();
    }
  }

  // Summary
  doc.addPage();
  addPageWatermark();
  fontBold(18).text("整體建議", { underline: true });
  doc.moveDown();
  fontRegular(11).text(storyboard.summary);

  doc.end();

  await new Promise<void>((resolve, reject) => {
    writeStream.on("finish", () => resolve());
    writeStream.on("error", reject);
  });

  const pdfBuffer = fs.readFileSync(filePath);
  const { key: pdfKey } = await storagePut(fileName, pdfBuffer, "application/pdf");
  fs.unlinkSync(filePath);
  const { url: pdfDownloadUrl } = await storageGet(pdfKey);
  console.log("[StoryboardExport] PDF generated:", { key: pdfKey, url: pdfDownloadUrl, watermark: addWatermark });

  return { url: pdfDownloadUrl, message: addWatermark ? "PDF 已生成（含水印）！升級專業版可移除水印。" : "PDF 已生成！" };
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
            text: "⚠ 本文檔由 MV Studio Pro 免費版生成，升級專業版可移除水印",
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
            text: `場景 ${scene.sceneNumber}`,
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
    if (scene.previewImageUrl) {
      try {
        const imgData = await downloadImageWithDimensions(scene.previewImageUrl);
        let imageBuffer = imgData.buffer;
        
        // Add watermark to image if free tier
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
            children: [new TextRun({ text: "[圖片加載失敗]", italics: true, color: "999999", font: "Microsoft YaHei" })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          })
        );
      }
    }

    // Scene details
    const details = [
      { label: "場景描述", value: scene.description },
      { label: "鏡頭運動", value: scene.cameraMovement },
      { label: "情緒氛圍", value: scene.mood },
      { label: "視覺元素", value: scene.visualElements.join("、") },
    ];

    if (scene.transition) {
      details.push({ label: "轉場建議", value: scene.transition });
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
        new TextRun({ text: "整體建議", bold: true, size: 32, font: "Microsoft YaHei" }),
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
              text: `${WATERMARK_TEXT} | ${WATERMARK_URL} | 免費版 — 升級專業版移除水印`,
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
              text: `© ${WATERMARK_TEXT} — ${WATERMARK_URL} | 本文檔含水印，升級專業版可移除`,
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
  const { key: wordKey } = await storagePut(wordFileName, buffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const { url: wordDownloadUrl } = await storageGet(wordKey);
  console.log("[StoryboardExport] Word generated:", { key: wordKey, url: wordDownloadUrl, watermark: addWatermark });

  return { url: wordDownloadUrl, message: addWatermark ? "Word 文檔已生成（含水印）！升級專業版可移除水印。" : "Word 文檔已生成！" };
}
