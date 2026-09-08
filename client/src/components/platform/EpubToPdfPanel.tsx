import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  EPUB_LIMITS,
  epubPdfBlob,
  parseEpub,
  type ParsedEpub,
} from "@/lib/epubToPdf";

export function EpubToPdfPanel({
  disabled = false,
  onImportText,
}: {
  disabled?: boolean;
  onImportText: (text: string, title: string) => void;
}) {
  const [source, setSource] = useState<{ file: File; book: ParsedEpub } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastPdf, setLastPdf] = useState<{ blob: Blob; name: string } | null>(
    null
  );
  const mounted = useRef(true);
  const running = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const pdf = trpc.mvAnalysis.downloadPlatformPdf.useMutation();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const buttonStyle =
    "rounded-lg border border-white/15 px-3 py-2 text-xs text-violet-100 hover:bg-white/10 disabled:opacity-40";
  function download(result: { blob: Blob; name: string }) {
    const url = URL.createObjectURL(result.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function upload(file?: File) {
    if (!file || running.current || disabled) return;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!/\.epub$/i.test(file.name))
        throw new Error("请选择 .epub 格式的电子书");
      if (file.size > EPUB_LIMITS.archiveBytes)
        throw new Error("EPUB 文件超过 20 MB，请先拆分电子书");
      const book = await parseEpub(await file.arrayBuffer(), file.name);
      if (mounted.current) setSource({ file, book });
    } catch (e) {
      if (mounted.current)
        setError(
          `${e instanceof Error ? e.message : "电子书读取失败"}。已读取的素材和上次 PDF 均保留。`
        );
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function convert() {
    if (!source || disabled || running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await pdf.mutateAsync({
        html: source.book.html,
        token: "epub-convert",
      });
      const blob = epubPdfBlob(result.pdfBase64);
      const name = `${source.book.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120) || "电子书"}.pdf`;
      if (mounted.current) {
        const output = { blob, name };
        setLastPdf(output);
        download(output);
        setNotice("PDF 已生成并开始下载。");
      }
    } catch {
      if (mounted.current)
        setError(
          "PDF 转换暂未成功，请稍后重试。原电子书与上次成功的 PDF 均保留。"
        );
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section
      aria-label="EPUB 转 PDF"
      className="mt-4 space-y-3 rounded-xl border border-white/10 bg-white/[0.025] p-4"
    >
      <div>
        <h3 className="text-sm font-medium text-slate-100">
          电子书 EPUB 转 PDF
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          支持未加密 EPUB，单个文件不超过 20 MB、解压后不超过 64
          MB。按原章节顺序排版，保留基本标题、段落、列表、表格及 PNG／JPG／WebP
          插图。原书字体和复杂版式不保留。
        </p>
      </div>
      <p className="text-xs text-slate-400">
        读取在本机进行；点击转换后将整理后的内容发送到转换服务。转换不调用提炼或生图，不扣生成积分。刷新页面后需重新上传。
      </p>
      <input
        ref={input}
        type="file"
        accept=".epub,application/epub+zip"
        className="hidden"
        aria-label="选择 EPUB 文件"
        disabled={disabled || busy}
        onChange={event => {
          const file = event.target.files?.[0];
          void upload(file);
          event.target.value = "";
        }}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonStyle}
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
        >
          上传 EPUB
        </button>
        <button
          type="button"
          className={buttonStyle}
          disabled={disabled || busy || !source}
          onClick={() => void convert()}
        >
          {busy ? "正在处理…" : "转换并下载 PDF"}
        </button>
        <button
          type="button"
          className={buttonStyle}
          disabled={disabled || busy || !source?.book.text.trim()}
          onClick={() => {
            if (source && !disabled && !running.current) {
              setError("");
              setNotice("");
              try {
                onImportText(source.book.text, source.book.title);
                setNotice("正文已送入上方图文笔记，请确认材料后再提炼。");
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "正文导入失败，电子书与上次 PDF 保持不变"
                );
              }
            }
          }}
        >
          正文送入图文笔记
        </button>
        {lastPdf && (
          <button
            type="button"
            className={buttonStyle}
            onClick={() => download(lastPdf)}
          >
            重新下载上次 PDF
          </button>
        )}
      </div>
      {source && (
        <p className="text-xs text-slate-300">
          当前素材：{source.file.name} · {source.book.chapterCount} 章 ·{" "}
          {source.book.text.length.toLocaleString()} 字符 ·{" "}
          {source.book.imageCount} 张插图
          {!source.book.text.trim() ? "；仅有插图，无可导入正文" : ""}
        </p>
      )}
      {source?.book.warnings.map(warning => (
        <p key={warning} className="text-xs text-amber-200">
          {warning}
        </p>
      ))}
      {lastPdf && (
        <p className="text-xs text-slate-400">上次成功文件：{lastPdf.name}</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-emerald-300">
          {notice}
        </p>
      )}
    </section>
  );
}
