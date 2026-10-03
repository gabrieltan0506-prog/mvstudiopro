import JSZip from "jszip";
import {
  NOVEL_SOURCE_MAX_CHARS,
  type ManhuaNovelDraft,
  type NovelChapter,
} from "@shared/manhuaNovelSource";
import {
  PDF_IMPORT_ASSETS,
  OCR_IMPORT_ASSETS,
} from "@shared/documentImportAssets";
import { readDocumentZipText } from "./documentZipText";

export type NovelImportOptions = {
  signal?: AbortSignal;
  forceOcr?: boolean;
  onProgress?: (message: string) => void;
};
type InputFile = {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};
const maxBytes = 64 * 1024 * 1024;

async function abortable<T>(
  work: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) return work;
  signal.throwIfAborted();
  let listener = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    listener = () => reject(signal.reason);
    signal.addEventListener("abort", listener, { once: true });
    if (signal.aborted) listener();
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}

function checkedText(text: string): string {
  if (text.length > NOVEL_SOURCE_MAX_CHARS)
    throw new Error(
      "原文超过40万字符，请按卷分批导入；不会截断，当前原文保留。"
    );
  return text;
}
function plainDraft(name: string, text: string): ManhuaNovelDraft {
  if (!text.trim()) throw new Error("文件没有可读取的正文，当前原文保留。");
  return {
    name: name.slice(0, 120),
    text: checkedText(text),
    from: 0,
    to: 0,
    enabled: false,
  };
}

async function importDoc(
  file: InputFile,
  options: NovelImportOptions
): Promise<ManhuaNovelDraft> {
  const bytes = await file.arrayBuffer();
  options.signal?.throwIfAborted();
  const worker = new Worker("/document-import/doc-1.0.4/worker.js");
  try {
    options.onProgress?.("读取 DOC…");
    const text = await abortable(
      new Promise<string>((resolve, reject) => {
        worker.onmessage = event =>
          event.data.error
            ? reject(new Error(event.data.error))
            : resolve(event.data.text);
        worker.onerror = () =>
          reject(new Error("DOC 读取失败，当前原文保留。"));
        worker.postMessage(bytes, [bytes]);
      }),
      options.signal
    );
    return {
      ...plainDraft(file.name, text),
      importInfo: {
        format: "doc",
        ocrPages: [],
        warnings: ["DOC 文字已导入，请对照原文件校对。"],
      },
    };
  } finally {
    worker.terminate();
  }
}

async function importDocx(
  file: InputFile,
  options: NovelImportOptions
): Promise<ManhuaNovelDraft> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  options.signal?.throwIfAborted();
  const raw = await readDocumentZipText(
    zip.file("word/document.xml"),
    16 * 1024 * 1024
  );
  const doc = new DOMParser().parseFromString(raw, "application/xml");
  if (doc.querySelector("parsererror"))
    throw new Error("Word 正文格式无法完整读取，当前原文保留。");
  const warnings = ["Word 仅导入文字与表格文本；插图和排版需对照原文件。"];
  const deleted = Array.from(doc.getElementsByTagNameNS("*", "del"));
  if (deleted.length) {
    deleted.forEach(n => n.remove());
    warnings.push("文档含修订，已按接受修订后的正文读取，请校对。");
  }
  function walk(node: Node): string {
    if (node.nodeType !== 1) return "";
    const el = node as Element,
      tag = el.localName;
    if (tag === "t") return el.textContent || "";
    if (tag === "tab") return "\t";
    if (tag === "br" || tag === "cr") return "\n";
    if (tag === "footnoteReference" || tag === "endnoteReference")
      return `［${tag === "footnoteReference" ? "脚注" : "尾注"}${el.getAttribute("w:id") || ""}］`;
    const body = Array.from(el.childNodes).map(walk).join("");
    return (
      body + (tag === "p" || tag === "tr" ? "\n" : tag === "tc" ? "\t" : "")
    );
  }
  const body = doc.getElementsByTagNameNS("*", "body")[0];
  if (!body) throw new Error("Word 缺少正文，当前原文保留。");
  let text = walk(body);
  for (const kind of ["footnotes", "endnotes"]) {
    options.signal?.throwIfAborted();
    if (!zip.file(`word/${kind}.xml`)) continue;
    const notes = new DOMParser().parseFromString(
      await readDocumentZipText(zip.file(`word/${kind}.xml`), 8 * 1024 * 1024),
      "application/xml"
    );
    if (notes.querySelector("parsererror"))
      throw new Error("Word 注释无法完整读取，当前原文保留。");
    const nodes = Array.from(
      notes.getElementsByTagNameNS(
        "*",
        kind === "footnotes" ? "footnote" : "endnote"
      )
    );
    for (const note of nodes) {
      const id = Number(note.getAttribute("w:id"));
      if (id > 0)
        text += `\n［${kind === "footnotes" ? "脚注" : "尾注"}${id}］\n${walk(note)}`;
    }
  }
  return {
    ...plainDraft(file.name, text),
    importInfo: { format: "docx", warnings, ocrPages: [] },
  };
}

async function importPdf(
  file: InputFile,
  options: NovelImportOptions
): Promise<ManhuaNovelDraft> {
  options.onProgress?.("加载 PDF 解析器…");
  const pdfjs = await import("pdfjs-dist");
  options.onProgress?.("打开 PDF…");
  options.signal?.throwIfAborted();
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_IMPORT_ASSETS + "pdf.worker.mjs";
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: PDF_IMPORT_ASSETS + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: PDF_IMPORT_ASSETS + "standard_fonts/",
    wasmUrl: PDF_IMPORT_ASSETS + "wasm/",
    stopAtErrors: true,
    isEvalSupported: false,
  });
  let worker:
    | Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>
    | undefined;
  let pendingWorker: Promise<NonNullable<typeof worker>> | undefined;
  let currentPage = 0,
    totalPages = 0;
  const cancel = () => {
    void task.destroy().catch(() => {});
    if (worker) void worker.terminate().catch(() => {});
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  const check = () => options.signal?.throwIfAborted();
  const report = (label: string) =>
    options.onProgress?.(`第 ${currentPage}/${totalPages} 页 · ${label}`);
  try {
    check();
    const pdf = await task.promise;
    totalPages = pdf.numPages;
    if (totalPages > 10000)
      throw new Error("PDF 超过一万页，请分卷导入；当前原文保留。");
    let text = "",
      line = 1;
    const chapters: NovelChapter[] = [],
      ocrPages: number[] = [],
      emptyPages: number[] = [];
    for (currentPage = 1; currentPage <= totalPages; currentPage++) {
      check();
      report("读取文字");
      const page = await pdf.getPage(currentPage);
      try {
        const content = await page.getTextContent();
        let pageText = content.items
          .map(item =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""
          )
          .join("")
          .trim();
        if (
          options.forceOcr ||
          pageText.replace(/\s/g, "").length < 40 ||
          pageText.includes("\uFFFD")
        ) {
          report("准备文字辨识，首次需下载语言资料");
          if (!worker) {
            const { createWorker, OEM, PSM } = await import("tesseract.js");
            check();
            pendingWorker = createWorker(
              ["chi_sim", "chi_tra", "eng"],
              OEM.LSTM_ONLY,
              {
                workerPath: OCR_IMPORT_ASSETS + "worker.min.js",
                corePath: OCR_IMPORT_ASSETS,
                workerBlobURL: false,
                logger: m => {
                  if (
                    !options.signal?.aborted &&
                    m.status === "recognizing text"
                  )
                    report(`文字辨识 ${Math.round(m.progress * 100)}%`);
                },
              }
            );
            worker = await abortable(pendingWorker, options.signal);
            check();
            await worker.setParameters({
              tessedit_pageseg_mode: PSM.AUTO,
              preserve_interword_spaces: "1",
            });
          }
          check();
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({
            scale: Math.min(3, 3200 / Math.max(base.width, base.height)),
          });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          try {
            const ctx = canvas.getContext("2d");
            if (!ctx)
              throw new Error("浏览器无法读取扫描页面，请换用桌面浏览器。");
            await page.render({ canvas, canvasContext: ctx, viewport }).promise;
            check();
            const result = await abortable(
              worker.recognize(canvas),
              options.signal
            );
            check();
            pageText = result.data.text.trim();
            ocrPages.push(currentPage);
          } finally {
            canvas.width = canvas.height = 0;
          }
        }
        if (!pageText) emptyPages.push(currentPage);
        const start = text.length;
        text +=
          `［原文件第 ${currentPage} 页］\n${pageText || "［此页未识别到文字，请对照原文件］"}` +
          (currentPage < totalPages ? "\n\n" : "");
        checkedText(text);
        chapters.push({
          title: `第 ${currentPage} 页${ocrPages.includes(currentPage) ? " · OCR待校对" : ""}`,
          start,
          end: text.length,
          line,
        });
        line += (text.slice(start).match(/\n/g) || []).length;
      } finally {
        page.cleanup();
      }
    }
    check();
    if (emptyPages.length === totalPages)
      throw new Error(
        "所有页面均未识别到文字，请提供更清晰的文件；当前原文保留。"
      );
    const warnings = [
      "PDF 按原页顺序导入，多栏、表格及文字顺序请对照原文件校对。",
    ];
    if (ocrPages.length)
      warnings.push(
        `共 ${ocrPages.length} 页使用OCR（已逐页标记），可能有错字或漏字，请校对后再改编。`
      );
    if (emptyPages.length)
      warnings.push(
        `第 ${emptyPages.join("、")} 页未识别到文字，已保留位置，没有当作完整读入。`
      );
    return {
      ...plainDraft(file.name, text),
      chapters,
      importInfo: { format: "pdf", pageCount: totalPages, ocrPages, warnings },
    };
  } catch (error) {
    check();
    if (
      error instanceof Error &&
      /PasswordException|password/i.test(error.name + error.message)
    )
      throw new Error("PDF 受密码保护，请解锁后重新导入；当前原文保留。");
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", cancel);
    // Also dispose a worker whose language initialization completes after cancellation.
    if (worker) await worker.terminate().catch(() => {});
    else if (pendingWorker)
      void pendingWorker.then(w => w.terminate()).catch(() => {});
    await task.destroy().catch(() => {});
  }
}

export async function importManhuaDocument(
  file: InputFile,
  options: NovelImportOptions = {}
): Promise<ManhuaNovelDraft> {
  if (file.size > maxBytes)
    throw new Error("文件超过64MB，请分卷导入；当前原文保留。");
  options.signal?.throwIfAborted();
  const extension = file.name.split(".").pop()?.toLowerCase();
  let result: ManhuaNovelDraft;
  if (extension === "epub")
    result = (await (await import("./manhuaEpubImport")).importManhuaEpub(file))
      .draft;
  else if (extension === "docx") result = await importDocx(file, options);
  else if (extension === "pdf") result = await importPdf(file, options);
  else if (["txt", "md", "markdown"].includes(extension || "")) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer()
      );
    } catch {
      throw new Error("文本不是UTF-8编码，请转换编码后导入；当前原文保留。");
    }
    result = plainDraft(file.name, text);
  } else if (extension === "doc") result = await importDoc(file, options);
  else throw new Error("请选择 doc、docx、pdf、md、txt 或 epub 文件。");
  options.signal?.throwIfAborted();
  return result;
}
