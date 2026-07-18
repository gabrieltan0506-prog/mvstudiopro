import { useMemo, useState } from "react";
import {
  HTML_PPT_QUALITY_CHECKLIST_ZH,
  HTML_PPT_STYLES,
  buildDefaultHtmlPptPages,
  buildHtmlPptDocument,
  normalizeHtmlPptPages,
  recommendHtmlPptStyle,
  type HtmlPptPage,
  type HtmlPptStyleId,
} from "@shared/htmlPptMaker";

type StepId = "setup" | "outline" | "export";

const STEPS: { id: StepId; label: string }[] = [
  { id: "setup", label: "1. 设定" },
  { id: "outline", label: "2. 页面清单" },
  { id: "export", label: "3. 预览导出" },
];

export default function PlatformHtmlPptPanel({ disabled }: { disabled?: boolean }) {
  const [step, setStep] = useState<StepId>("setup");
  const [title, setTitle] = useState("AI 行业趋势汇报");
  const [purpose, setPurpose] = useState("数据洞察汇报");
  const [pageCount, setPageCount] = useState(8);
  const [styleId, setStyleId] = useState<HtmlPptStyleId>(() => recommendHtmlPptStyle("数据洞察汇报"));
  const [pages, setPages] = useState<HtmlPptPage[]>([]);
  const [html, setHtml] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");

  const styleList = useMemo(
    () => Object.entries(HTML_PPT_STYLES) as [HtmlPptStyleId, (typeof HTML_PPT_STYLES)[HtmlPptStyleId]][],
    [],
  );

  const rebuildOutline = () => {
    setPages(buildDefaultHtmlPptPages(title, pageCount, purpose, styleId));
    setStep("outline");
  };

  const updatePage = (index: number, patch: Partial<HtmlPptPage>) => {
    setPages((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const updateBullet = (pageIndex: number, bulletIndex: number, value: string) => {
    setPages((prev) =>
      prev.map((p, i) => {
        if (i !== pageIndex) return p;
        const bullets = [...(p.bullets || [])];
        bullets[bulletIndex] = value;
        return { ...p, bullets };
      }),
    );
  };

  const addBullet = (pageIndex: number) => {
    setPages((prev) =>
      prev.map((p, i) => {
        if (i !== pageIndex) return p;
        const bullets = [...(p.bullets || []), "新要点"];
        return { ...p, bullets: bullets.slice(0, 8) };
      }),
    );
  };

  const removePage = (index: number) => {
    setPages((prev) => (prev.length <= 3 ? prev : prev.filter((_, i) => i !== index)));
  };

  const addPage = () => {
    setPages((prev) => {
      if (prev.length >= 16) return prev;
      return [...prev, { title: `新页面 ${prev.length + 1}`, bullets: ["要点一", "要点二"] }];
    });
  };

  const generateFromOutline = () => {
    const normalized = normalizeHtmlPptPages(pages);
    if (normalized.length < 3) {
      rebuildOutline();
      return;
    }
    const doc = buildHtmlPptDocument({
      title,
      styleId,
      purposeZh: purpose,
      pages: normalized,
    });
    setPages(normalized);
    setHtml(doc);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(new Blob([doc], { type: "text/html;charset=utf-8" })));
    setStep("export");
  };

  const download = () => {
    const normalized = normalizeHtmlPptPages(pages);
    const doc =
      html ||
      buildHtmlPptDocument({
        title,
        styleId,
        purposeZh: purpose,
        pages: normalized.length ? normalized : buildDefaultHtmlPptPages(title, pageCount, purpose, styleId),
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
        <div className="text-sm font-semibold text-white/90">动效PPT生成演示</div>
        <p className="mt-1 text-[11px] leading-relaxed text-white/50">
          流程：设定 → 确认页面清单 → 预览导出。多风格 16:9 横向翻页单文件 HTML（站内预设，无需上传
          PPTX）。
        </p>
      </div>

      <div className="inline-flex flex-wrap gap-1 rounded-xl border border-white/10 bg-black/40 p-0.5">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              if (s.id === "outline" && !pages.length) rebuildOutline();
              else setStep(s.id);
            }}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold disabled:opacity-40 ${
              step === s.id ? "bg-white/15 text-white" : "text-white/45 hover:text-white/70"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {step === "setup" ? (
        <div className="space-y-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-white/35">设定</div>
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
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/35">
              风格（选用前可预览）
            </div>
            <div className="grid gap-3 lg:grid-cols-[1fr_minmax(220px,320px)]">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {styleList.map(([id, meta]) => (
                  <button
                    key={id}
                    type="button"
                    disabled={disabled}
                    title={meta.whenZh}
                    onClick={() => setStyleId(id)}
                    className={`overflow-hidden rounded-xl border text-left disabled:opacity-40 ${
                      styleId === id
                        ? "border-emerald-400/55 ring-1 ring-emerald-400/30"
                        : "border-white/10 hover:border-white/25"
                    }`}
                  >
                    <div className="aspect-video w-full bg-black/40">
                      <img
                        src={meta.previewUrl}
                        alt={meta.labelZh}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                    <div className="space-y-0.5 px-2 py-1.5">
                      <div className="text-[11px] font-semibold text-white/90">{meta.labelZh}</div>
                      <div className="line-clamp-2 text-[10px] text-white/40">{meta.blurbZh}</div>
                      <div className="flex gap-1 pt-0.5">
                        {[meta.palette.bg, meta.palette.accent, meta.palette.text].map((c) => (
                          <span
                            key={c}
                            className="h-2.5 w-2.5 rounded-full border border-white/20"
                            style={{ background: c }}
                          />
                        ))}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-white/35">
                  当前选中预览
                </div>
                {(() => {
                  const meta = HTML_PPT_STYLES[styleId];
                  return (
                    <div
                      className="aspect-video overflow-hidden rounded-xl border border-white/15 shadow-lg"
                      style={{ background: meta.palette.bg, color: meta.palette.text }}
                    >
                      <img
                        src={meta.previewUrl}
                        alt={`${meta.labelZh} 预览`}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  );
                })()}
                <p className="text-[10px] leading-relaxed text-white/45">
                  {HTML_PPT_STYLES[styleId].labelZh} · {HTML_PPT_STYLES[styleId].whenZh}
                  。本地包：Downloads/2026Jul18/template/{styleId}/
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            disabled={disabled || !title.trim()}
            onClick={rebuildOutline}
            className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-[12px] font-semibold text-emerald-50 disabled:opacity-40"
          >
            用此风格生成页面清单
          </button>
        </div>
      ) : null}

      {step === "outline" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-white/35">
              页面清单（可改标题/要点，确认后再导出）
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={rebuildOutline}
                className="text-[10px] text-white/50 underline-offset-2 hover:underline disabled:opacity-40"
              >
                按设定重生成
              </button>
              <button
                type="button"
                disabled={disabled || pages.length >= 16}
                onClick={addPage}
                className="text-[10px] text-white/50 underline-offset-2 hover:underline disabled:opacity-40"
              >
                加一页
              </button>
            </div>
          </div>
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {pages.map((p, i) => (
              <div key={`page-${i}`} className="rounded-xl border border-white/10 bg-black/35 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] text-white/35">P{i + 1}</span>
                  <input
                    disabled={disabled}
                    value={p.title}
                    onChange={(e) => updatePage(i, { title: e.target.value })}
                    className="min-w-[160px] flex-1 rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[12px] font-semibold text-white"
                  />
                  <input
                    disabled={disabled}
                    value={p.kpi || ""}
                    onChange={(e) => updatePage(i, { kpi: e.target.value })}
                    placeholder="KPI"
                    className="w-20 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-violet-100/80"
                  />
                  <button
                    type="button"
                    disabled={disabled || pages.length <= 3}
                    onClick={() => removePage(i)}
                    className="text-[10px] text-white/35 hover:text-white/70 disabled:opacity-30"
                  >
                    删除
                  </button>
                </div>
                <div className="space-y-1">
                  {(p.bullets || []).map((b, bi) => (
                    <input
                      key={`b-${i}-${bi}`}
                      disabled={disabled}
                      value={b}
                      onChange={(e) => updateBullet(i, bi, e.target.value)}
                      className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white/75"
                    />
                  ))}
                  <button
                    type="button"
                    disabled={disabled || (p.bullets || []).length >= 8}
                    onClick={() => addBullet(i)}
                    className="text-[10px] text-white/40 underline-offset-2 hover:underline disabled:opacity-40"
                  >
                    + 要点
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={disabled || pages.length < 3}
            onClick={generateFromOutline}
            className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-[12px] font-semibold text-emerald-50 disabled:opacity-40"
          >
            确认清单并生成预览
          </button>
        </div>
      ) : null}

      {step === "export" ? (
        <div className="space-y-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-white/35">预览导出</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={generateFromOutline}
              className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
            >
              刷新预览
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={download}
              className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-[12px] font-semibold text-emerald-50 disabled:opacity-40"
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
            <button
              type="button"
              disabled={disabled}
              onClick={() => setStep("outline")}
              className="text-[11px] text-white/45 underline-offset-2 hover:underline"
            >
              返回改清单
            </button>
          </div>
          {previewUrl ? (
            <iframe
              title="html-ppt-preview"
              src={previewUrl}
              className="h-[360px] w-full overflow-hidden rounded-xl border border-white/10 bg-black"
            />
          ) : (
            <div className="rounded-xl border border-dashed border-white/15 px-3 py-10 text-center text-[11px] text-white/40">
              请先确认页面清单
            </div>
          )}
          <pre className="whitespace-pre-wrap rounded-lg border border-white/10 bg-black/40 p-3 text-[10px] leading-relaxed text-white/45">
            {HTML_PPT_QUALITY_CHECKLIST_ZH}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
