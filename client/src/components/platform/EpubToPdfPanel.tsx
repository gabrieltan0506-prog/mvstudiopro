import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { parseEpub, type ParsedEpub } from "@/lib/epubToPdf";
import {
  saveEpubSource,
  loadEpubSource,
  convertEpubPdfParts,
} from "@/lib/epubPdfParts";

export function EpubToPdfPanel({
  disabled = false,
  onImportText,
  userId,
}: {
  disabled?: boolean;
  userId?: number;
  onImportText: (text: string, title: string) => void | Promise<void>;
}) {
  const [source, setSource] = useState<{
    file: File;
    book: ParsedEpub;
    sourceId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastPdf, setLastPdf] = useState<{ blob: Blob; name: string } | null>(
    null
  );
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    kind: "reading" | "converting";
  } | null>(null);
  const scope = userId ? `u${userId}` : "guest";
  const operation = useRef(0);
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
  useEffect(() => {
    const id = ++operation.current;
    let cancelled = false;
    running.current = true;
    setBusy(true);
    setSource(null);
    setLastPdf(null);
    setError("");
    setNotice("");
    setProgress(null);
    void (async () => {
      try {
        const saved = await loadEpubSource(scope);
        if (!saved || cancelled || id !== operation.current) return;
        const book = await parseEpub(
          await saved.file.arrayBuffer(),
          saved.file.name,
          {
            onProgress: value => {
              if (!cancelled && id === operation.current)
                setProgress({ ...value, kind: "reading" });
            },
          }
        );
        if (!cancelled && id === operation.current) {
          setSource({ ...saved, book });
          setNotice("已恢复上次电子书，继续转换时会复用已完成的分片。");
        }
      } catch (error) {
        if (!cancelled && id === operation.current)
          setError(
            error instanceof Error
              ? error.message
              : "电子书恢复失败，请重新选择原文件"
          );
      } finally {
        if (!cancelled && id === operation.current) {
          running.current = false;
          setBusy(false);
          setProgress(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope]);
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
    const id = ++operation.current;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!/\.epub$/i.test(file.name))
        throw new Error("请选择 .epub 格式的电子书");
      const book = await parseEpub(await file.arrayBuffer(), file.name, {
        onProgress: value => {
          if (mounted.current && id === operation.current)
            setProgress({ ...value, kind: "reading" });
        },
      });
      if (!mounted.current || id !== operation.current) return;
      const sourceId = await saveEpubSource(file, scope);
      if (mounted.current && id === operation.current)
        setSource({ file, book, sourceId });
    } catch (e) {
      if (mounted.current && id === operation.current)
        setError(
          `${e instanceof Error ? e.message : "电子书读取失败"}。已读取的素材和上次结果均保留。`
        );
    } finally {
      if (mounted.current && id === operation.current) {
        running.current = false;
        setBusy(false);
        setProgress(null);
      }
    }
  }
  async function convert() {
    if (!source || disabled || running.current) return;
    const id = ++operation.current;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const output = await convertEpubPdfParts({
        scope,
        sourceId: source.sourceId,
        title: source.book.title,
        parts: source.book.parts,
        renderPart: async html => {
          if (!mounted.current || id !== operation.current)
            throw new Error("已暂停转换，完成的分片已保留");
          return (await pdf.mutateAsync({ html, token: "epub-convert" }))
            .pdfBase64;
        },
        onProgress: value => {
          if (mounted.current && id === operation.current)
            setProgress({ ...value, kind: "converting" });
        },
      });
      if (mounted.current && id === operation.current) {
        setLastPdf(output);
        download(output);
        setNotice(
          output.partCount === 1
            ? "PDF 已生成并开始下载。"
            : `全部 ${output.partCount} 个分片已转换，正在下载按阅读顺序排列的 PDF 压缩包。`
        );
      }
    } catch (error) {
      if (mounted.current && id === operation.current)
        setError(
          `${error instanceof Error ? error.message : "PDF 转换暂未成功"}。已完成分片与原电子书均保留，再次转换将从未完成部分继续。`
        );
    } finally {
      if (mounted.current && id === operation.current) {
        running.current = false;
        setBusy(false);
        setProgress(null);
      }
    }
  }
  async function importText() {
    if (!source || disabled || running.current) return;
    const id = ++operation.current;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("正在上传正文并完整阅读…");
    try {
      await onImportText(source.book.text, source.book.title);
      if (mounted.current && id === operation.current)
        setNotice("正文阅读已结束，请在上方查看阅读结果与方案。");
    } catch (error) {
      if (mounted.current && id === operation.current) {
        setNotice("");
        setError(
          error instanceof Error
            ? error.message
            : "正文导入失败，电子书与上次 PDF 保持不变"
        );
      }
    } finally {
      if (mounted.current && id === operation.current) {
        running.current = false;
        setBusy(false);
      }
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
          支持未加密
          EPUB。大书会按章节和内容分片处理，按原顺序保留标题、段落、列表、表格及
          PNG／JPG／WebP 插图。原书字体和复杂版式不保留。
        </p>
      </div>
      <p className="text-xs text-slate-400">
        读取在本机进行；转换时逐片处理并保存进度。小书下载 PDF，大书下载有序的
        PDF 分片压缩包。转换不扣生成积分，刷新后可继续。
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
          onClick={() => void importText()}
        >
          正文送入图文笔记
        </button>
        {lastPdf && (
          <button
            type="button"
            className={buttonStyle}
            onClick={() => download(lastPdf)}
          >
            重新下载上次结果
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
      {progress && (
        <p role="status" className="text-xs text-slate-300">
          {progress.kind === "reading" ? "正在读取章节" : "正在转换分片"}：
          {progress.done}/{progress.total}
        </p>
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
