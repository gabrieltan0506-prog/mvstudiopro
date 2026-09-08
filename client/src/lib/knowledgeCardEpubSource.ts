import JSZip from "jszip";
import { epubPdfBlob, parseEpub } from "./epubToPdf";
import { convertEpubPdfParts, saveEpubSource } from "./epubPdfParts";

/** EPUB 在上传前按完整章节顺序转换；中断保留原书和已完成 PDF 检查点。 */
export async function prepareKnowledgeCardEpubFiles(input: {
  file: File;
  userId: number;
  renderPart: (html: string) => Promise<string>;
  onProgress?: (progress: {
    done: number;
    total: number;
  }) => void | Promise<void>;
}): Promise<File[]> {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0)
    throw new Error("请登录后再导入 EPUB");
  const { file } = input;
  if (!(file instanceof File) || !file.size || !/\.epub$/i.test(file.name))
    throw new Error("请选择非空 EPUB 文件");
  const title =
    file.name
      .replace(/\.epub$/i, "")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
      .trim() || "电子书";
  const scope = `u${input.userId}`;
  const parsed = await parseEpub(await file.arrayBuffer(), title);
  const sourceId = await saveEpubSource(file, scope);
  const result = await convertEpubPdfParts({
    sourceId,
    scope,
    title,
    parts: parsed.parts,
    renderPart: async html => {
      const base64 = await input.renderPart(html);
      await pdfFile(epubPdfBlob(base64), title);
      return base64;
    },
    onProgress: input.onProgress,
  });
  async function pdfFile(blob: Blob, name: string) {
    if (
      blob.size < 20 ||
      !(await blob.slice(0, 5).text()).startsWith("%PDF-") ||
      !(await blob.slice(-2048).text()).includes("%%EOF")
    )
      throw new Error("转换后的 PDF 不完整，已保存的原书和分片仍保留");
    return new File([blob], name, {
      type: "application/pdf",
      lastModified: file.lastModified,
    });
  }
  if (result.partCount === 1)
    return [await pdfFile(result.blob, `${title}.pdf`)];
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer(), {
    checkCRC32: true,
  });
  const entries = Object.values(zip.files)
    .filter(entry => !entry.dir)
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  if (
    entries.length !== parsed.parts.length ||
    entries.length !== result.partCount
  )
    throw new Error("电子书 PDF 分片数量不完整，已保存的分片仍保留");
  const files: File[] = [];
  for (let index = 0; index < entries.length; index++) {
    const part = parsed.parts[index]!;
    const expected = `${String(index + 1).padStart(Math.max(4, String(entries.length).length), "0")}-第${part.chapterStart}至${part.chapterEnd}章.pdf`;
    if (entries[index]!.name !== expected)
      throw new Error(
        "电子书 PDF 分片顺序或章节编号不一致，已保存的分片仍保留"
      );
    files.push(
      await pdfFile(await entries[index]!.async("blob"), `${title}-${expected}`)
    );
  }
  return files;
}
