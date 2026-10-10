import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  parseCodeMotionCsv,
  parseCodeMotionXlsx,
} from "./codeMotionSpreadsheet";
import { extractDocumentText } from "../growth/documentExtract";
import {
  getGcsBucketName,
  inspectGcsObjectBounded,
  uploadBufferToGcsIfAbsent,
} from "./gcs";
import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource";
export const CODE_MOTION_IMPORT_BYTES = 8 * 1024 * 1024;
export type CodeMotionImportDeps = {
  resolve: typeof resolveRegisteredPostProdMediaSource;
  read(uri: string): Promise<Buffer>;
  extract: typeof extractDocumentText;
  archive(name: string, bytes: Buffer, mime: string): Promise<string>;
};
const real: CodeMotionImportDeps = {
  resolve: resolveRegisteredPostProdMediaSource,
  async read(uri) {
    const chunks: Buffer[] = [];
    await inspectGcsObjectBounded({
      gcsUri: uri,
      maxBytes: CODE_MOTION_IMPORT_BYTES,
      timeoutMs: 30_000,
      onChunk: b => chunks.push(Buffer.from(b)),
    });
    return Buffer.concat(chunks);
  },
  extract: extractDocumentText,
  async archive(name, buffer, contentType) {
    await uploadBufferToGcsIfAbsent({
      objectName: name,
      buffer,
      contentType,
      signal: AbortSignal.timeout(30_000),
    });
    return `gs://${getGcsBucketName()}/${name}`;
  },
};
export async function importCodeMotionFile(
  userId: string,
  input: { gcsUri: string; name: string; bytes: number },
  deps = real
) {
  if (!/^[0-9]+$/.test(userId)) throw new Error("账号无法确认");
  const extension = input.name.split(".").at(-1)?.toLowerCase() || "";
  if (
    ![
      "png",
      "jpg",
      "jpeg",
      "webp",
      "pdf",
      "docx",
      "md",
      "xlsx",
      "csv",
    ].includes(extension)
  )
    throw new Error("请选择 PNG、JPG、WebP、PDF、DOCX、MD、XLSX 或 CSV 文件");
  if (input.bytes <= 0 || input.bytes > CODE_MOTION_IMPORT_BYTES)
    throw new Error("单个文件不得超过 8 MB");
  const uri = await deps.resolve({ userId, source: input.gcsUri });
  const buffer = await deps.read(uri);
  if (buffer.length !== input.bytes || buffer.length > CODE_MOTION_IMPORT_BYTES)
    throw new Error("实际文件大小与上传不一致，请重新上传");
  if (extension === "xlsx" || extension === "csv") {
    const workbook =
      extension === "xlsx"
        ? await parseCodeMotionXlsx(buffer)
        : parseCodeMotionCsv(buffer);
    return {
      kind: "spreadsheet" as const,
      name: input.name,
      workbook,
      message:
        "已读取表格，请选择工作表、名称列、数值列和行范围；未自动采用数据。",
    };
  }
  if (["png", "jpg", "jpeg", "webp"].includes(extension)) {
    const metadata = await sharp(buffer, {
      limitInputPixels: 16 * 1024 * 1024,
      animated: false,
    }).metadata();
    const expected = extension === "jpg" ? "jpeg" : extension;
    if (
      metadata.format !== expected ||
      !metadata.width ||
      !metadata.height ||
      (metadata.pages || 1) > 1
    )
      throw new Error("图片内容与文件类型不一致，或包含动画，请上传静态图片");
    // 读取全部像素以拒绝仅文件头有效但正文损坏的图片；不改变原字节。
    await sharp(buffer, {
      limitInputPixels: 16 * 1024 * 1024,
      animated: false,
      failOn: "warning",
    }).stats();
    const sha = createHash("sha256").update(buffer).digest("hex");
    const gcsUri = await deps.archive(
      `uploads/u${userId}/code-motion/${sha}.${expected}`,
      buffer,
      `image/${expected}`
    );
    return {
      kind: "image" as const,
      image: { id: randomUUID(), name: input.name, gcsUri },
      message: "图片已核对，原图保留。",
    };
  }
  let text: string;
  if (extension === "md") {
    try {
      text = new TextDecoder("utf-8", { fatal: true })
        .decode(buffer)
        .replace(/^\uFEFF/, "");
    } catch {
      throw new Error("MD 文件不是有效 UTF-8 文字，请另存后再导入");
    }
  } else {
    if (extension === "pdf" && buffer.subarray(0, 5).toString() !== "%PDF-")
      throw new Error("文件内容不是有效 PDF");
    if (
      extension === "docx" &&
      buffer.subarray(0, 4).toString("hex") !== "504b0304"
    )
      throw new Error("文件内容不是有效 DOCX");
    const result = await deps.extract({
      buffer,
      fileName: input.name,
      mimeType:
        extension === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      abortSignal: AbortSignal.timeout(45_000),
    });
    if (extension === "pdf" && result.method !== "pdf_pdftotext")
      throw new Error(
        "PDF 没有读到可靠正文，可能是扫描件或文字读取服务不可用。请复制需要的文字或改用 DOCX/MD；本次未进行文字辨识。"
      );
    text = result.text;
  }
  if (!text.trim()) throw new Error("没有读到可用正文，请复制需要的文字再继续");
  if (text.length > 200_000)
    throw new Error(
      "文档正文超过 20 万字，请先挑出需要的章节再导入；没有截断或替换现有材料"
    );
  return {
    kind: "document" as const,
    text,
    name: input.name,
    chars: text.length,
    message:
      extension === "md"
        ? "已读取完整文字，请选用本条视频需要的内容。"
        : "已读取文档文字，请对照原件校对；排版和插图不包含在内。",
  };
}

export function assertCodeMotionImageSource(userId: string, uri: string) {
  const prefix = `gs://${getGcsBucketName()}/uploads/u${userId}/code-motion/`;
  if (
    !uri.startsWith(prefix) ||
    !/^[a-f0-9]{64}\.(png|jpeg|webp)$/.test(uri.slice(prefix.length))
  )
    throw new Error("请在映刻重新导入图片，确保确认与导出使用同一份原图");
}
