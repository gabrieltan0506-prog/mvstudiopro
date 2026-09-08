import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const exec = promisify(execFile);
const MAX_SOURCE_BYTES = 200 * 1024 * 1024;
const MAX_TEXT_BYTES = 64 * 1024 * 1024;
const TEXT_SECTION_CHARACTERS = 12_000;
const MAX_RENDERED_BYTES = 1024 * 1024 * 1024;
export type KnowledgeCardDocumentPage = {
  pageNumber: number;
  text: string;
  /** 图像页仅在iterator验SHA并检查实际像素后可为true；清单阶段保守为false。 */
  isBlankCandidate: boolean;
  imagePath?: string;
  imageDigest?: string;
  width?: number;
  height?: number;
};
export type KnowledgeCardDocumentPagesManifest = {
  sourceDigest: string;
  sourceFormat: "pdf" | "image" | "text";
  totalPages: number;
  pages: KnowledgeCardDocumentPage[];
};
export type KnowledgeCardDocumentPagesInput = {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
  signal?: AbortSignal;
};
const digest = (buffer: Buffer) =>
  createHash("sha256").update(buffer).digest("hex");

async function command(
  name: string,
  args: string[],
  maxBuffer = 1024 * 1024,
  signal?: AbortSignal
) {
  try {
    return await exec(name, args, {
      timeout: 120_000,
      maxBuffer,
      encoding: "utf8",
      signal,
      env: { ...process.env, LC_ALL: "C" },
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(`文档渲染工具未安装：${name}`);
    throw new Error(
      `文档读取或渲染失败（${name}）：文件可能损坏、加密、内容过大或处理超时`
    );
  }
}

/** 所有文件只在回调期间可读；最终清理仅涉及本模块创建的临时原件和图片，不产生或删除JSON证据。 */
export async function withKnowledgeCardDocumentPages<T>(
  input: KnowledgeCardDocumentPagesInput,
  consume: (manifest: KnowledgeCardDocumentPagesManifest) => Promise<T>
): Promise<T> {
  input.signal?.throwIfAborted();
  if (!Buffer.isBuffer(input.buffer) || !input.buffer.length)
    throw new Error("文档内容为空");
  if (input.buffer.length > MAX_SOURCE_BYTES)
    throw new Error("文档超过200MB读取上限，请拆分后处理；未截取部分页面");
  const mime = input.mimeType.toLowerCase().split(";")[0]!.trim();
  const name = input.fileName?.toLowerCase() || "";
  if (
    /\.(docx?|pptx?|epub)$/.test(name) ||
    /word|presentation|powerpoint|epub/.test(mime)
  )
    throw new Error(
      "此格式暂不能保留原版视觉，请先转换成PDF再进行完整页面阅读"
    );
  const sourceDigest = digest(input.buffer);
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "knowledge-document-pages-")
  );
  try {
    let manifest: KnowledgeCardDocumentPagesManifest;
    if (mime === "application/pdf" || name.endsWith(".pdf")) {
      if (input.buffer.subarray(0, 5).toString("ascii") !== "%PDF-")
        throw new Error("PDF文件头无效，不能按正文提取冒充视觉阅读");
      const pdfPath = path.join(directory, "source.pdf");
      await fs.writeFile(pdfPath, input.buffer);
      const info = (
        await command("pdfinfo", [pdfPath], 1024 * 1024, input.signal)
      ).stdout;
      if (/^Encrypted:\s+yes/im.test(info))
        throw new Error("暂不支持加密PDF，请提供未加密版本");
      const totalPages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
      if (!Number.isSafeInteger(totalPages) || totalPages < 1)
        throw new Error("无法确认PDF真实页数，已停止读取");
      const text = (
        await command(
          "pdftotext",
          ["-layout", "-enc", "UTF-8", pdfPath, "-"],
          MAX_TEXT_BYTES,
          input.signal
        )
      ).stdout;
      const pageTexts = text.split("\f");
      if (
        pageTexts.length === totalPages + 1 &&
        !pageTexts[pageTexts.length - 1]!.trim()
      )
        pageTexts.pop();
      if (pageTexts.length !== totalPages)
        throw new Error(
          `PDF文字页与物理页数量不一致（${pageTexts.length}/${totalPages}），未继续生成`
        );
      const pages: KnowledgeCardDocumentPage[] = [];
      let renderedBytes = 0;
      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
        const prefix = path.join(
          directory,
          `page-${String(pageNumber).padStart(6, "0")}`
        );
        await command(
          "pdftoppm",
          [
            "-f",
            String(pageNumber),
            "-l",
            String(pageNumber),
            "-scale-to-x",
            "1920",
            "-scale-to-y",
            "-1",
            "-png",
            "-singlefile",
            pdfPath,
            prefix,
          ],
          1024 * 1024,
          input.signal
        );
        const imagePath = `${prefix}.png`;
        input.signal?.throwIfAborted();
        renderedBytes += (await fs.stat(imagePath)).size;
        if (renderedBytes > MAX_RENDERED_BYTES)
          throw new Error(
            "全页图片超过1GB临时存储上限，请拆分文档；未将部分页面标为完成"
          );
        const bytes = await fs.readFile(imagePath);
        const metadata = await sharp(bytes, {
          limitInputPixels: 100_000_000,
          failOn: "error",
        }).metadata();
        if (!metadata.width || !metadata.height || metadata.format !== "png")
          throw new Error(`第${pageNumber}页未返回有效页面图片`);
        pages.push({
          pageNumber,
          text: pageTexts[pageNumber - 1]!,
          isBlankCandidate: false,
          imagePath,
          imageDigest: digest(bytes),
          width: metadata.width,
          height: metadata.height,
        });
      }
      manifest = { sourceDigest, sourceFormat: "pdf", totalPages, pages };
    } else if (
      /^image\/(png|jpeg|webp)$/.test(mime) ||
      /\.(png|jpe?g|webp)$/.test(name)
    ) {
      const metadata = await sharp(input.buffer, {
        limitInputPixels: 100_000_000,
        failOn: "error",
        animated: true,
      }).metadata();
      if ((metadata.pages || 1) !== 1)
        throw new Error(
          "暂不支持多帧图片，请将全部帧转为PDF或独立图片，不能只读取第一帧"
        );
      const imagePath = path.join(directory, "page-000001.png");
      await sharp(input.buffer, {
        limitInputPixels: 100_000_000,
        failOn: "error",
      })
        .rotate()
        .resize({ width: 1920, withoutEnlargement: true })
        .png()
        .toFile(imagePath);
      const bytes = await fs.readFile(imagePath);
      const dimensions = await sharp(bytes).metadata();
      if (!dimensions.width || !dimensions.height)
        throw new Error("图片内容无法解码");
      manifest = {
        sourceDigest,
        sourceFormat: "image",
        totalPages: 1,
        pages: [
          {
            pageNumber: 1,
            text: "",
            isBlankCandidate: false,
            imagePath,
            imageDigest: digest(bytes),
            width: dimensions.width,
            height: dimensions.height,
          },
        ],
      };
    } else if (
      ["text/plain", "text/markdown"].includes(mime) ||
      /\.(txt|md)$/.test(name)
    ) {
      if (input.buffer.length > MAX_TEXT_BYTES)
        throw new Error("文字文档超过64MB读取上限，未截断正文");
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(input.buffer);
      } catch {
        throw new Error("文字编码不是有效UTF-8，请转换编码后重新上传");
      }
      // 文字没有物理页：按连续逻辑段读取，保留所有字符，避免切开UTF-16代理对。
      const pages: KnowledgeCardDocumentPage[] = [];
      let offset = 0;
      do {
        let end = Math.min(offset + TEXT_SECTION_CHARACTERS, text.length);
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
        const section = text.slice(offset, end);
        pages.push({ pageNumber: pages.length + 1, text: section, isBlankCandidate: section.trim() === "" });
        offset = end;
      } while (offset < text.length);
      manifest = { sourceDigest, sourceFormat: "text", totalPages: pages.length, pages };
    } else
      throw new Error(
        "暂不支持此文件格式，请提供PDF、PNG、JPG、WebP、TXT或Markdown"
      );
    input.signal?.throwIfAborted();
    return await consume(manifest);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

/** 只接受近乎恒定白或完全透明；均值接近白不能掩盖细线、扫描字或小图标。 */
async function isBlankImageCandidate(imageBuffer: Buffer): Promise<boolean> {
  const decoder = sharp(imageBuffer, {
    limitInputPixels: 100_000_000,
    failOn: "error",
  });
  const [metadata, statistics] = await Promise.all([
    decoder.metadata(),
    decoder.stats(),
  ]);
  const channels = statistics.channels;
  const hasAlpha = metadata.hasAlpha === true;
  const alpha = hasAlpha ? channels.at(-1) : undefined;
  if (alpha?.max === 0) return true;
  // PNG可能为16位；不能把16位中的暗色255误当8位纯白。
  const maximum =
    metadata.depth === "uchar" ? 255 : metadata.depth === "ushort" ? 65535 : 0;
  if (!maximum) return false;
  const colors = hasAlpha ? channels.slice(0, -1) : channels;
  return (
    colors.length > 0 &&
    colors.every(
      channel =>
        channel.min / maximum >= 254 / 255 &&
        (channel.max - channel.min) / maximum <= 1 / 255 &&
        channel.stdev / maximum <= 0.05 / 255
    )
  );
}

/** 按页读取图片；调用者消费后释放该页Buffer，不将整书图片一次性载入内存。 */
export async function* iterateKnowledgeCardDocumentPages(
  manifest: KnowledgeCardDocumentPagesManifest,
  signal?: AbortSignal
): AsyncGenerator<KnowledgeCardDocumentPage & { imageBuffer?: Buffer }> {
  if (manifest.pages.length !== manifest.totalPages)
    throw new Error("页面清单数量不完整");
  for (let index = 0; index < manifest.pages.length; index++) {
    signal?.throwIfAborted();
    const page = manifest.pages[index]!;
    if (page.pageNumber !== index + 1) throw new Error("页面清单顺序不完整");
    if (!page.imagePath) {
      yield { ...page, isBlankCandidate: page.text.trim() === "" };
      continue;
    }
    const imageBuffer = await fs.readFile(page.imagePath);
    if (!imageBuffer.length || digest(imageBuffer) !== page.imageDigest)
      throw new Error(`第${page.pageNumber}页图片已变化或损坏`);
    const isBlankCandidate =
      page.text.trim() === "" && (await isBlankImageCandidate(imageBuffer));
    signal?.throwIfAborted();
    yield { ...page, imageBuffer, isBlankCandidate };
  }
}
