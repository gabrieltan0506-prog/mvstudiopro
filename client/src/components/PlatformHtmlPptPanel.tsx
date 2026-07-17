import { useMemo, useState } from "react";
import {
  HTML_PPT_QUALITY_CHECKLIST_ZH,
  HTML_PPT_STYLES,
  buildDefaultHtmlPptPages,
  buildHtmlPptDocument,
  recommendHtmlPptStyle,
  type HtmlPptStyleId,
} from "@shared/htmlPptMaker";

export default function PlatformHtmlPptPanel({ disabled }: { disabled?: boolean }) {
  const [title, setTitle] = useState("AI 行业趋势汇报");
  const [purpose, setPurpose] = useState("数据洞察汇报");
  const [pageCount, setPageCount] = useState(8);
  const [styleId, setStyleId] = useState<HtmlPptStyleId>(() => recommendHtmlPptStyle("数据洞察汇报"));
  const [html, setHtml] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");

  const styleList = useMemo(() => Object.entries(HTML_PPT_STYLES) as [HtmlPptStyleId, (typeof HTML_PPT_STYLES)[HtmlPptStyleId]][], []);

  const generate = () => {
    const pages = buildDefaultHtmlPptPages(title, pageCount, purpose);
    const doc = buildHtmlPptDocument({ title, styleId, purposeZh: purpose, pages });
    setHtml(doc);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(new Blob([doc], { type: "text/html;charset=utf-8" }));
    setPreviewUrl(url);
  };

  const download = () => {
    if (!html) generate();
    const doc = html || buildHtmlPptDocument({
      title,
      styleId,
      purposeZh: purpose,
      pages: buildDefaultHtmlPptPages(title, pageCount, purpose),
    });
    const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title.slice(0, 24).replace(/\s+/g, "-") || "website-ppt"}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-4">
      <div>
        <div className="text-sm font-semibold text-white/90">网站式 HTML PPT</div>
        <p className="mt-1 text-[11px] leading-relaxed text-white/50">
          三风格 16:9 横向翻页单文件 HTML（暗黑数据 / 黑橙路演 / 蓝白 Figma）。对齐黄白参考图仓视觉，不依赖未开源 Marvis zip。
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-[11px] text-white/60">
          主题
          <input
            disabled={disabled}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
          />
        </label>
        <label className="block text-[11px] text-white/60">
          用途
          <input
            disabled={disabled}
            value={purpose}
            onChange={(e) => {
              setPurpose(e.target.value);
              setStyleId(recommendHtmlPptStyle(e.target.value));
            }}
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
            placeholder="汇报 / 路演 / 复盘…"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-[11px] text-white/60">
          页数
          <input
            type="number"
            min={3}
            max={16}
            disabled={disabled}
            value={pageCount}
            onChange={(e) => setPageCount(Number(e.target.value) || 8)}
            className="mt-1 w-24 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {styleList.map(([id, meta]) => (
            <button
              key={id}
              type="button"
              disabled={disabled}
              title={meta.whenZh}
              onClick={() => setStyleId(id)}
              className={`rounded-lg border px-2.5 py-1.5 text-left text-[11px] disabled:opacity-40 ${
                styleId === id
                  ? "border-violet-400/45 bg-violet-500/15 text-violet-50"
                  : "border-white/10 bg-white/5 text-white/65 hover:border-white/25"
              }`}
            >
              <div className="font-semibold">{meta.labelZh}</div>
              <div className="text-[10px] text-white/40">{meta.blurbZh}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={generate}
          className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-[12px] font-semibold text-emerald-50 disabled:opacity-40"
        >
          生成预览
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={download}
          className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          导出 HTML
        </button>
        {previewUrl ? (
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-[12px] text-sky-100"
          >
            新窗口打开
          </a>
        ) : null}
      </div>

      {previewUrl ? (
        <iframe
          title="html-ppt-preview"
          src={previewUrl}
          className="h-[360px] w-full overflow-hidden rounded-xl border border-white/10 bg-black"
        />
      ) : (
        <div className="rounded-xl border border-dashed border-white/15 px-3 py-10 text-center text-[11px] text-white/40">
          填写主题后点「生成预览」；可用 ← → / 空格翻页
        </div>
      )}

      <pre className="whitespace-pre-wrap rounded-lg border border-white/10 bg-black/40 p-3 text-[10px] leading-relaxed text-white/45">
        {HTML_PPT_QUALITY_CHECKLIST_ZH}
      </pre>
    </div>
  );
}
