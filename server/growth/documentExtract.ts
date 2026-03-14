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
      maxBuffer: 8 * 1024 * 1024,
    });

    return normalizeText(decodeXmlEntities(stdout));
  });
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  return withTempFile(buffer, "pdf", async (filePath) => {
    const { stdout } = await execFileAsync("strings", [filePath], {
      maxBuffer: 8 * 1024 * 1024,
    });

    return normalizeText(stdout);
  });
}

export async function extractDocumentText(params: {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
}): Promise<{ text: string; method: "docx_xml" | "pdf_strings" | "none" }> {
  const fileName = String(params.fileName || "").toLowerCase();

  if (
    params.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.endsWith(".docx")
  ) {
    const text = await extractDocxText(params.buffer).catch(() => "");
    return { text, method: text ? "docx_xml" : "none" };
  }

  if (params.mimeType === "application/pdf" || fileName.endsWith(".pdf")) {
    const text = await extractPdfText(params.buffer).catch(() => "");
    return { text, method: text ? "pdf_strings" : "none" };
  }

  return { text: "", method: "none" };
}
