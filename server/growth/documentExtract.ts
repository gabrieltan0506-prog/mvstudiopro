import { execFile } from "child_process";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeText(value: string): string {
  return value
    .replace(/<w:p[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function withTempFile<T>(
  buffer: Buffer,
  extension: string,
  fn: (filePath: string) => Promise<T>,
): Promise<T> {
  const filePath = path.join(
    os.tmpdir(),
    `growth-camp-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension.replace(/^\./, "")}`,
  );

  await fs.writeFile(filePath, buffer);
  try {
    return await fn(filePath);
  } finally {
    await fs.unlink(filePath).catch(() => undefined);
  }
}

export async function extractDocxText(buffer: Buffer): Promise<string> {
  return withTempFile(buffer, "docx", async (filePath) => {
    const { stdout } = await execFileAsync("unzip", ["-p", filePath, "word/document.xml"], {
      maxBuffer: 32 * 1024 * 1024,
    });

    return normalizeText(decodeXmlEntities(stdout));
  });
}

/** 优先 pdftotext（整书可选中文字）；失败再退 strings。 */
export async function extractPdfText(
  buffer: Buffer,
): Promise<{ text: string; method: "pdf_pdftotext" | "pdf_strings" | "none" }> {
  return withTempFile(buffer, "pdf", async (filePath) => {
    try {
      const { stdout } = await execFileAsync(
        "pdftotext",
        ["-layout", "-enc", "UTF-8", filePath, "-"],
        { maxBuffer: 64 * 1024 * 1024 },
      );
      const text = normalizeText(stdout);
      if (text.length >= 40) return { text, method: "pdf_pdftotext" };
    } catch {
      /* fall through */
    }
    try {
      const { stdout } = await execFileAsync("strings", ["-n", "3", filePath], {
        maxBuffer: 64 * 1024 * 1024,
      });
      const text = normalizeText(stdout);
      return { text, method: text ? "pdf_strings" : "none" };
    } catch {
      return { text: "", method: "none" };
    }
  });
}

/** pptx：unzip 抽 ppt/slides/slide*.xml 内 `<a:t>` 文本。 */
export async function extractPptxText(buffer: Buffer): Promise<string> {
  return withTempFile(buffer, "pptx", async (filePath) => {
    const { stdout: listing } = await execFileAsync("unzip", ["-l", filePath], {
      maxBuffer: 16 * 1024 * 1024,
    });
    const slideMatches = Array.from(listing.matchAll(/ppt\/slides\/slide\d+\.xml/g)).map((m) => m[0]);
    const slides = Array.from(new Set(slideMatches)).sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)/)?.[1] || 0);
      return na - nb;
    });

    const parts: string[] = [];
    for (const slide of slides) {
      const { stdout } = await execFileAsync("unzip", ["-p", filePath, slide], {
        maxBuffer: 16 * 1024 * 1024,
      });
      const texts = Array.from(stdout.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)).map((m) =>
        decodeXmlEntities(m[1] || ""),
      );
      const pageText = texts.join(" ").replace(/\s+/g, " ").trim();
      if (pageText) parts.push(pageText);
    }
    return normalizeText(parts.join("\n\n"));
  });
}

export type DocumentExtractMethod = "docx_xml" | "pdf_pdftotext" | "pdf_strings" | "pptx_xml" | "none";

export async function extractDocumentText(params: {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
}): Promise<{ text: string; method: DocumentExtractMethod }> {
  const fileName = String(params.fileName || "").toLowerCase();
  const mime = String(params.mimeType || "").toLowerCase();

  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.endsWith(".docx")
  ) {
    const text = await extractDocxText(params.buffer).catch(() => "");
    return { text, method: text ? "docx_xml" : "none" };
  }

  if (mime === "application/pdf" || fileName.endsWith(".pdf")) {
    const pdf = await extractPdfText(params.buffer).catch(
      () => ({ text: "", method: "none" as const }),
    );
    return { text: pdf.text, method: pdf.method };
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    fileName.endsWith(".pptx")
  ) {
    const text = await extractPptxText(params.buffer).catch(() => "");
    return { text, method: text ? "pptx_xml" : "none" };
  }

  return { text: "", method: "none" };
}
