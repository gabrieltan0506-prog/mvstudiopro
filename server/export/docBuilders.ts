import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import PDFDocument from "pdfkit";
import type { StoryboardDocExport } from "../../shared/export/types.js";

function buildLines(doc: StoryboardDocExport, watermarkText?: string) {
  const lines: string[] = [];
  if (watermarkText) lines.push(watermarkText, "");
  lines.push(doc.title || "Storyboard Export", "");
  if (doc.script) lines.push("Script", doc.script, "");

  for (const scene of Array.isArray(doc.scenes) ? doc.scenes : []) {
    lines.push(`Scene ${scene.sceneIndex}`);
    if (scene.sceneTitle) lines.push(`Title: ${scene.sceneTitle}`);
    if (scene.scenePrompt) lines.push(`Prompt: ${scene.scenePrompt}`);
    if (scene.character) lines.push(`Character: ${scene.character}`);
    if (scene.environment) lines.push(`Environment: ${scene.environment}`);
    if (scene.action) lines.push(`Action: ${scene.action}`);
    if (scene.camera) lines.push(`Camera: ${scene.camera}`);
    if (scene.mood) lines.push(`Mood: ${scene.mood}`);
    if (scene.lighting) lines.push(`Lighting: ${scene.lighting}`);
    if (Array.isArray(scene.imageUrls) && scene.imageUrls.length) {
      lines.push("Storyboard Images:");
      for (const x of scene.imageUrls) lines.push(`- ${x}`);
    }
    if (Array.isArray(scene.referenceImages) && scene.referenceImages.length) {
      lines.push("Reference Images:");
      for (const x of scene.referenceImages) lines.push(`- ${x}`);
    }
    lines.push("", "--------------------------------", "");
  }

  if (watermarkText) lines.push(watermarkText);
  return lines;
}

export async function buildStoryboardDocx(doc: StoryboardDocExport, watermarkText?: string) {
  const sections: Paragraph[] = [];
  if (watermarkText) {
    sections.push(new Paragraph({ children: [new TextRun({ text: watermarkText, bold: true })] }));
    sections.push(new Paragraph({ text: "" }));
  }

  sections.push(new Paragraph({ text: doc.title || "Storyboard Export", heading: HeadingLevel.TITLE }));
  if (doc.script) {
    sections.push(new Paragraph({ text: "Script", heading: HeadingLevel.HEADING_1 }));
    sections.push(new Paragraph({ text: doc.script }));
  }

  for (const scene of Array.isArray(doc.scenes) ? doc.scenes : []) {
    sections.push(new Paragraph({ text: `Scene ${scene.sceneIndex}`, heading: HeadingLevel.HEADING_1 }));
    if (scene.sceneTitle) sections.push(new Paragraph({ text: `Title: ${scene.sceneTitle}` }));
    if (scene.scenePrompt) sections.push(new Paragraph({ text: `Prompt: ${scene.scenePrompt}` }));
    if (scene.character) sections.push(new Paragraph({ text: `Character: ${scene.character}` }));
    if (scene.environment) sections.push(new Paragraph({ text: `Environment: ${scene.environment}` }));
    if (scene.action) sections.push(new Paragraph({ text: `Action: ${scene.action}` }));
    if (scene.camera) sections.push(new Paragraph({ text: `Camera: ${scene.camera}` }));
    if (scene.mood) sections.push(new Paragraph({ text: `Mood: ${scene.mood}` }));
    if (scene.lighting) sections.push(new Paragraph({ text: `Lighting: ${scene.lighting}` }));

    if (Array.isArray(scene.imageUrls) && scene.imageUrls.length) {
      sections.push(new Paragraph({ text: "Storyboard Images:" }));
      for (const x of scene.imageUrls) sections.push(new Paragraph({ text: `- ${x}` }));
    }

    if (Array.isArray(scene.referenceImages) && scene.referenceImages.length) {
      sections.push(new Paragraph({ text: "Reference Images:" }));
      for (const x of scene.referenceImages) sections.push(new Paragraph({ text: `- ${x}` }));
    }

    sections.push(new Paragraph({ text: "" }));
  }

  if (watermarkText) {
    sections.push(new Paragraph({ children: [new TextRun({ text: watermarkText, bold: true })] }));
  }

  const docx = new Document({ sections: [{ properties: {}, children: sections }] });
  return await Packer.toBuffer(docx);
}

export async function buildStoryboardPdf(doc: StoryboardDocExport, watermarkText?: string): Promise<Buffer> {
  const pdf = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Uint8Array[] = [];

  pdf.on("data", (chunk: Uint8Array) => chunks.push(chunk));
  const ended = new Promise<Buffer>((resolve) => {
    pdf.on("end", () => resolve(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))));
  });

  const lines = buildLines(doc, watermarkText);

  pdf.fontSize(22).text(doc.title || "Storyboard Export", { underline: false });
  pdf.moveDown();

  for (const line of lines) {
    if (line === doc.title) continue;
    if (!line) {
      pdf.moveDown(0.5);
      continue;
    }
    if (/^Scene \d+/.test(line) || line === "Script") {
      pdf.fontSize(16).text(line);
    } else {
      pdf.fontSize(11).text(line);
    }
  }

  pdf.end();
  return await ended;
}
