import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { execHeavyMedia } from "./heavyMediaProcess";

/** 字库和CPU推理库随镜像固定安装，请求时不安装包、不下载模型。 */
export async function recognizeConversionPdf(source: string, pages: string[], dir: string, signal: AbortSignal) {
  const manifest: Array<{ image?: string; text?: string }> = [];
  const images: string[] = [];
  for (let index = 0; index < pages.length; index++) {
    signal.throwIfAborted();
    if (pages[index]!.trim().length >= 40) { manifest.push({ text: pages[index] }); continue; }
    const prefix = path.join(dir, `ocr-${index + 1}`);
    await execHeavyMedia("pdftoppm", ["-f", String(index + 1), "-l", String(index + 1), "-singlefile", "-scale-to", "4096", "-png", source, prefix], { signal, maxBuffer: 1024 * 1024 });
    const image = `${prefix}.png`; images.push(image); manifest.push({ image });
  }
  const input = path.join(dir, "ocr-input.json"), output = path.join(dir, "ocr-output.json");
  await writeFile(input, JSON.stringify(manifest));
  await execHeavyMedia(process.env.FILE_CONVERSION_PYTHON || "python3", [path.resolve("server/scripts/file_conversion_ocr.py"), input, output], { signal, maxBuffer: 1024 * 1024 });
  signal.throwIfAborted();
  const result = JSON.parse(await readFile(output, "utf8")) as { pages: string[]; confidences: number[]; warnings: string[]; lines: unknown[][] };
  if (result.pages.length !== pages.length || result.pages.some(text => !text.trim())) throw new Error("文字识别结果缺页，原文件保留");
  return { ...result, images };
}
