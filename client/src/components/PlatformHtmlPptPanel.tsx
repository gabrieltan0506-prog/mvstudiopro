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
import { CREDIT_COSTS } from "@shared/plans";
import { pollJobUntilTerminal } from "@/lib/jobs";
import { trpc } from "@/lib/trpc";

type StepId = "setup" | "outline" | "export";

const STEPS: { id: StepId; label: string }[] = [
  { id: "setup", label: "1. 设定" },
  { id: "outline", label: "2. 页面清单" },
  { id: "export", label: "3. 预览导出" },
];

export default function PlatformHtmlPptPanel({ disabled }: { disabled?: boolean }) {
  const [step, setStep] = useState<StepId>("setup");
  const [title, setTitle] = useState("AI漫剧的市场现状与前景");
  const [purpose, setPurpose] = useState("行业路演 / 数据洞察汇报");
  const [pageCount, setPageCount] = useState(13);
  const [styleId, setStyleId] = useState<HtmlPptStyleId>(() => recommendHtmlPptStyle("数据洞察汇报"));
  const [briefZh, setBriefZh] = useState(
    [
      "请做成高密度投屏稿，复杂比较必须进图表（bars/columns/compare/line/ring），禁止纯文字页。",
      "公开口径（DataEye/钛媒体等转述，讲解时标注来源）：",
      "· 2025 漫剧市场规模约 168 亿元；2026 预估约 243.6 亿元（+45%）。",
      "· 2025 抖音端原生上线破 6 万部；全年播放量超 700 亿次量级；用户约 1.2 亿→2026 或 2.8 亿。",
      "· 供给品类：表情包/沙雕 44.44%；解说/小说漫 25.89%；2D/3D 21.81%；AIGC/仿真人 6.1%；游戏编辑器 1.76%。",
      "· 漫剧占短剧播放：约 6 月 5%→12 月 35%；AIGC 播放量全年约 ×181；核心受众偏 24–30 岁男性。",
      "· 国内：抖音端原生领军、红果崛起；投流头部效应（番茄等）。",
      "· 出海：短剧出海渠道+本地化；国内备案仍是底座。",
      "· 政策：动画微短剧（含 AIGC）专项治理；2026-04-01 未备案存量强下线；红果/抖音 4/7 起升审核（立意+风险分级）；AI换脸/声纹侵权高风险。",
      "务必覆盖：品类占比、规模与预测、发展历史、新手入局、坑、国内平台、海外、政策；收束给可执行结论。",
    ].join("\n"),
  );
  const [pages, setPages] = useState<HtmlPptPage[]>([]);
  const [html, setHtml] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<string | null>(null);
  const [aiCost, setAiCost] = useState<number | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiBusyLabel, setAiBusyLabel] = useState("GPT-5.6 Sol 生成中…");

  const outlineCost = CREDIT_COSTS.platformHtmlPptOutline;
  const generateOutlineMutation = trpc.mvAnalysis.generateHtmlPptOutline.useMutation();

  const styleList = useMemo(
    () => Object.entries(HTML_PPT_STYLES) as [HtmlPptStyleId, (typeof HTML_PPT_STYLES)[HtmlPptStyleId]][],
    [],
  );

  const busy = disabled || aiBusy || generateOutlineMutation.isPending;

  const rebuildOutlineLocal = () => {
    setAiError(null);
    setAiSummary(null);
    setAiModel(null);
    setAiCost(null);
    setPages(buildDefaultHtmlPptPages(title, pageCount, purpose, styleId));
    setStep("outline");
  };

  const rebuildOutlineWithAi = async () => {
    setAiError(null);
    setAiBusy(true);
    setAiBusyLabel("正在入队…");
    try {
      const enqueued = await generateOutlineMutation.mutateAsync({
        title: title.trim(),
        purposeZh: purpose.trim() || undefined,
        pageCount,
        styleId,
        briefZh: briefZh.trim() || undefined,
      });
      setAiCost(typeof enqueued.cost === "number" ? enqueued.cost : outlineCost);
      setAiBusyLabel("后台生成中，请稍候…");
      const j = await pollJobUntilTerminal(enqueued.jobId, {
        intervalMs: 2500,
        maxWaitMs: 16 * 60_000,
        adaptiveBackoffAfterAttempts: 36,
        maxIntervalMs: 8000,
        onPoll: ({ status, attempt }) => {
          setAiBusyLabel(
            status === "queued"
              ? `排队中（第 ${attempt} 次）…`
              : `Sol 生成中（第 ${attempt} 次）…`,
          );
        },
      });
      if (j.status === "failed") {
        throw new Error(j.error || "动效PPT 清单生成失败");
      }
      const out =
        j.output && typeof j.output === "object" && !Array.isArray(j.output)
          ? (j.output as {
              pages?: unknown;
              deckTitle?: string;
              summary?: string;
              model?: string;
              cost?: number;
            })
          : {};
      const nextPages = normalizeHtmlPptPages(out.pages || []);
      if (nextPages.length < 3) throw new Error("返回页数不足");
      if (out.deckTitle?.trim()) setTitle(out.deckTitle.trim());
      setPages(nextPages);
      setAiSummary(out.summary || null);
      setAiModel(out.model || "gpt-5.6-sol");
      if (typeof out.cost === "number") setAiCost(out.cost);
      setStep("outline");
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "AI 清单生成失败";
      const msg = /Unexpected end of JSON|JSON\.parse|截断/i.test(raw)
        ? "清单输出不完整（可能被截断）。请将页数调到 10 以内后重试，或稍后再试。"
        : raw;
      setAiError(msg);
    } finally {
      setAiBusy(false);
      setAiBusyLabel("GPT-5.6 Sol 生成中…");
    }
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
      return [...prev, { title: `新页面 ${prev.length + 1}`, bullets: ["要点一", "要点二"], viz: "bars" }];
    });
  };

  const generateFromOutline = () => {
    const normalized = normalizeHtmlPptPages(pages);
    if (normalized.length < 3) {
      rebuildOutlineLocal();
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
          方案 A：<span className="text-emerald-200/90">GPT-5.6 Sol</span> 写详尽清单与绝对量级图表数据（
          {outlineCost} 积分/次），前端多色 SVG 分步动效（条/柱/环/折线/对照 compare）。图表不是 Image-2。空格=下一步动效，←→=翻页。
        </p>
      </div>

      <div className="inline-flex flex-wrap gap-1 rounded-xl border border-white/10 bg-black/40 p-0.5">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              if (s.id === "outline" && !pages.length) rebuildOutlineLocal();
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
                disabled={busy}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="block text-[11px] text-white/60">
              用途
              <input
                disabled={busy}
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
              disabled={busy}
              value={pageCount}
              onChange={(e) => setPageCount(Number(e.target.value) || 8)}
              className="mt-1 w-24 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="block text-[11px] text-white/60">
            补充背景 / 数据口径 / 受众（AI 必读，越具体越好）
            <textarea
              disabled={busy}
              value={briefZh}
              onChange={(e) => setBriefZh(e.target.value)}
              rows={3}
              placeholder="例：近 7 日小红书蓝海词、热搜 Top、品牌切入方向；受众为品牌运营…"
              className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/25"
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
                    disabled={busy}
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
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !title.trim()}
              onClick={() => void rebuildOutlineWithAi()}
              className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-[12px] font-semibold text-emerald-50 disabled:opacity-40"
            >
              {aiBusy || generateOutlineMutation.isPending
                ? aiBusyLabel
                : `用 GPT-5.6 Sol 生成页面清单（${outlineCost} 积分）`}
            </button>
            <button
              type="button"
              disabled={busy || !title.trim()}
              onClick={rebuildOutlineLocal}
              className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-[12px] font-semibold text-white/70 disabled:opacity-40"
            >
              仅用模板骨架（免费）
            </button>
          </div>
          {aiError ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
              {aiError}
            </div>
          ) : null}
        </div>
      ) : null}

      {step === "outline" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-white/35">
              页面清单（可改标题/要点，确认后再导出）
              {aiModel ? (
                <span className="ml-2 text-emerald-300/80">
                  · {aiModel}
                  {aiCost != null ? ` · 已扣 ${aiCost} 点` : ""}
                </span>
              ) : (
                <span className="ml-2 text-white/35">· 模板骨架</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void rebuildOutlineWithAi()}
                className="text-[10px] text-emerald-300/80 underline-offset-2 hover:underline disabled:opacity-40"
              >
                再跑 AI
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={rebuildOutlineLocal}
                className="text-[10px] text-white/50 underline-offset-2 hover:underline disabled:opacity-40"
              >
                换模板骨架
              </button>
              <button
                type="button"
                disabled={busy || pages.length >= 16}
                onClick={addPage}
                className="text-[10px] text-white/50 underline-offset-2 hover:underline disabled:opacity-40"
              >
                加一页
              </button>
            </div>
          </div>
          {aiSummary ? (
            <p className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-[11px] text-white/55">
              {aiSummary}
            </p>
          ) : null}
          {aiError ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
              {aiError}
            </div>
          ) : null}
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {pages.map((p, i) => (
              <div key={`page-${i}`} className="rounded-xl border border-white/10 bg-black/35 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] text-white/35">P{i + 1}</span>
                  {p.viz ? (
                    <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-100">
                      {p.viz}
                    </span>
                  ) : null}
                  <input
                    disabled={busy}
                    value={p.title}
                    onChange={(e) => updatePage(i, { title: e.target.value })}
                    className="min-w-[160px] flex-1 rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[12px] font-semibold text-white"
                  />
                  <input
                    disabled={busy}
                    value={p.kpi || ""}
                    onChange={(e) => updatePage(i, { kpi: e.target.value })}
                    placeholder="KPI"
                    className="w-20 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-violet-100/80"
                  />
                  <button
                    type="button"
                    disabled={busy || pages.length <= 3}
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
                      disabled={busy}
                      value={b}
                      onChange={(e) => updateBullet(i, bi, e.target.value)}
                      className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white/75"
                    />
                  ))}
                  <button
                    type="button"
                    disabled={busy || (p.bullets || []).length >= 8}
                    onClick={() => addBullet(i)}
                    className="text-[10px] text-white/40 underline-offset-2 hover:underline disabled:opacity-40"
                  >
                    + 要点
                  </button>
                  {p.series?.length ? (
                    <div className="pt-1 text-[10px] text-white/35">
                      图表数据：
                      {p.series.map((s) => `${s.label}${Math.round(s.value)}`).join(" · ")}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || pages.length < 3}
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
              disabled={busy}
              onClick={generateFromOutline}
              className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
            >
              刷新预览
            </button>
            <button
              type="button"
              disabled={busy}
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
              disabled={busy}
              onClick={() => setStep("outline")}
              className="text-[11px] text-white/45 underline-offset-2 hover:underline"
            >
              返回改清单
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-white/45">
            投屏操作：空格 / 点击 / ↓ = 下一步动效；← → = 翻页（与动效分离，不会进页一次播完）。
          </p>
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
