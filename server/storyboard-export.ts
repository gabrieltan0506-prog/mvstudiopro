/**
 * Storyboard Export Module
 * Handles PDF and Word export for storyboard scripts.
 * PDF: Uses pdfkit with embedded font (downloaded from CDN on first use)
 * Word: Uses docx library for proper .docx generation
 */
import fs from "fs";
import path from "path";
import axios from "axios";
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

// ─── Font Management ────────────────────────────────────
const FONT_DIR = "/tmp/mvstudio-fonts";
const FONT_REGULAR = path.join(FONT_DIR, "NotoSansSC-Regular.ttf");
const FONT_BOLD = path.join(FONT_DIR, "NotoSansSC-Bold.ttf");

// Google Fonts CDN URLs for Noto Sans SC
const FONT_URLS = {
  regular: "https://fonts.gstatic.com/s/notosanssc/v37/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_EnYxNbPzS5HE.ttf",
  bold: "https://fonts.gstatic.com/s/notosanssc/v37/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_EnYxNbPzS5HE.ttf",
};

async function ensureFonts(): Promise<{ regular: string; bold: string }> {
  // First try local system fonts
  const localRegular = "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf";
  const localBold = "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Bold.otf";
  
  if (fs.existsSync(localRegular) && fs.existsSync(localBold)) {
    return { regular: localRegular, bold: localBold };
  }

  // Download from CDN if local fonts not available
  if (!fs.existsSync(FONT_DIR)) {
    fs.mkdirSync(FONT_DIR, { recursive: true });
  }

  if (!fs.existsSync(FONT_REGULAR)) {
    console.log("[StoryboardExport] Downloading regular font from CDN...");
    try {
      const resp = await axios.get(FONT_URLS.regular, { responseType: "arraybuffer", timeout: 30000 });
      fs.writeFileSync(FONT_REGULAR, Buffer.from(resp.data));
      console.log("[StoryboardExport] Regular font downloaded successfully");
    } catch (e) {
      console.error("[StoryboardExport] Failed to download regular font:", e);
      throw new Error("無法下載中文字體，PDF 導出暫時不可用。請嘗試 Word 格式導出。");
    }
  }

  // For bold, use regular as fallback (same weight from Google Fonts variable font)
  if (!fs.existsSync(FONT_BOLD)) {
    // Copy regular as bold fallback
    if (fs.existsSync(FONT_REGULAR)) {
      fs.copyFileSync(FONT_REGULAR, FONT_BOLD);
    }
  }

  return { regular: FONT_REGULAR, bold: FONT_BOLD };
}

// ─── PDF Export ─────────────────────────────────────────
export async function exportToPDF(storyboard: StoryboardData): Promise<{ url: string; message: string }> {
  const fonts = await ensureFonts();
  const PDFDocument = (await import("pdfkit")).default;

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const fileName = `storyboard_${Date.now()}.pdf`;
  const filePath = path.join("/tmp", fileName);
  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  // Helper: set Chinese font
  const fontBold = (size: number) => doc.fontSize(size).font(fonts.bold);
  const fontRegular = (size: number) => doc.fontSize(size).font(fonts.regular);

  // Title
  fontBold(24).text(storyboard.title, { align: "center" });
  doc.moveDown();

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

    fontBold(18).text(`場景 ${scene.sceneNumber}`, { underline: true });
    fontRegular(12).text(`${scene.timestamp} (${scene.duration})`);
    doc.moveDown();

    // Preview image
    if (scene.previewImageUrl) {
      try {
        const response = await axios.get(scene.previewImageUrl, {
          responseType: "arraybuffer",
          timeout: 15000,
        });
        const imageBuffer = Buffer.from(response.data);
        doc.image(imageBuffer, { fit: [500, 300], align: "center" });
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
  console.log("[StoryboardExport] PDF generated:", { key: pdfKey, url: pdfDownloadUrl });

  return { url: pdfDownloadUrl, message: "PDF 已生成！" };
}

// ─── Word Export ────────────────────────────────────────
export async function exportToWord(storyboard: StoryboardData): Promise<{ url: string; message: string }> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    ImageRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
    ShadingType,
  } = await import("docx");

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

    // Preview image
    if (scene.previewImageUrl) {
      try {
        const response = await axios.get(scene.previewImageUrl, {
          responseType: "arraybuffer",
          timeout: 15000,
        });
        const imageBuffer = Buffer.from(response.data);
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: imageBuffer,
                transformation: { width: 500, height: 280 },
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

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const wordFileName = `storyboard_${Date.now()}.docx`;
  const { key: wordKey } = await storagePut(wordFileName, buffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const { url: wordDownloadUrl } = await storageGet(wordKey);
  console.log("[StoryboardExport] Word generated:", { key: wordKey, url: wordDownloadUrl });

  return { url: wordDownloadUrl, message: "Word 文檔已生成！" };
}
