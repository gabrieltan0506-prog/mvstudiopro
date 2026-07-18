import { useMemo, useState } from "react";
import {
  HTML_PPT_STYLES,
  HTML_PPT_VIZ_KINDS,
  buildDefaultHtmlPptPages,
  buildHtmlPptDocument,
  normalizeHtmlPptPages,
  recommendHtmlPptStyle,
  type HtmlPptPage,
  type HtmlPptStyleId,
  type HtmlPptTheme,
  type HtmlPptVizKind,
} from "@shared/htmlPptMaker";
import { downloadHtmlPptPptx, listHtmlPptPptxImageUrls } from "@shared/htmlPptPptx";
import { INFOGRAPHIC_NOTE_TEMPLATES } from "@shared/infographicNoteTemplates";
import {
  CREDIT_COSTS,
  PLATFORM_HTML_PPT_PAGE_MAX,
  PLATFORM_HTML_PPT_PAGE_MIN,
  platformHtmlPptOutlineCredits,
  platformHtmlPptPagePatchCredits,
} from "@shared/plans";
import { pollJobUntilTerminal } from "@/lib/jobs";
import { trpc } from "@/lib/trpc";

type StepId = "setup" | "themes" | "outline" | "export";

const STEPS: { id: StepId; label: string }[] = [
  { id: "setup", label: "1. 设定" },
  { id: "themes", label: "2. 大纲" },
  { id: "outline", label: "3. 页面清单" },
  { id: "export", label: "4. 预览导出" },
];

type ThemeRow = { id: string; title: string; source: "user" | "ai"; selected: boolean };

function newThemeId(prefix: string, i: number) {
  return `${prefix}_${i + 1}_${Math.random().toString(36).slice(2, 6)}`;
}

function formatWaitLabel(prefix: string, elapsedMs: number) {
  const sec = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${prefix} · 已等待 ${sec}s`;
}

export default function PlatformHtmlPptPanel({ disabled }: { disabled?: boolean }) {
  const [step, setStep] = useState<StepId>("setup");
  const [title, setTitle] = useState("AI漫剧的市场现状与前景");
  const [purpose, setPurpose] = useState("行业路演 / 数据洞察汇报");
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [styleId, setStyleId] = useState<HtmlPptStyleId>(() => recommendHtmlPptStyle("数据洞察汇报"));
  const [briefZh, setBriefZh] = useState(
    [
      "请做成高密度投屏稿；复杂比较进图表；禁止纯文字空页。",
      "公开口径示例（讲解时标注来源）：2025 漫剧约 168 亿；2026 预估约 243.6 亿（+45%）。",
    ].join("\n"),
  );
  const [userThemeInputs, setUserThemeInputs] = useState<string[]>([
    "关键爆品",
    "现有市场规模",
    "入局门槛",
  ]);
  const [themeRows, setThemeRows] = useState<ThemeRow[]>([]);
  const [imageTemplateId, setImageTemplateId] = useState<string>("auto");
  const [enableSlideImages, setEnableSlideImages] = useState(true);

  const [pages, setPages] = useState<HtmlPptPage[]>([]);
  const [html, setHtml] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiCost, setAiCost] = useState<number | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiBusyLabel, setAiBusyLabel] = useState("处理中…");
  const [patchNotes, setPatchNotes] = useState<Record<number, string>>({});

  const perPageCost = CREDIT_COSTS.platformHtmlPptOutlinePerPage;
  const outlineCost = pageCount != null ? platformHtmlPptOutlineCredits(pageCount) : null;
  const patchCost = platformHtmlPptPagePatchCredits();
  const pageReady = pageCount != null && pageCount >= PLATFORM_HTML_PPT_PAGE_MIN;
  const userThemesReady = userThemeInputs.map((t) => t.trim()).filter(Boolean).length >= 3;

  const generateOutlineMutation = trpc.mvAnalysis.generateHtmlPptOutline.useMutation();
  const suggestThemesMutation = trpc.mvAnalysis.suggestHtmlPptThemes.useMutation();
  const patchPageMutation = trpc.mvAnalysis.patchHtmlPptPage.useMutation();
  const slideImageMutation = trpc.mvAnalysis.generateHtmlPptSlideImage.useMutation();
  const resolvePptxImagesMutation = trpc.mvAnalysis.resolveHtmlPptPptxImages.useMutation();

  const styleList = useMemo(
    () => Object.entries(HTML_PPT_STYLES) as [HtmlPptStyleId, (typeof HTML_PPT_STYLES)[HtmlPptStyleId]][],
    [],
  );

  const busy =
    disabled ||
    aiBusy ||
    generateOutlineMutation.isPending ||
    suggestThemesMutation.isPending ||
    patchPageMutation.isPending ||
    slideImageMutation.isPending ||
    resolvePptxImagesMutation.isPending;

  const confirmedThemes = (): HtmlPptTheme[] =>
    themeRows.filter((t) => t.selected && t.title.trim()).map((t) => ({ id: t.id, title: t.title.trim() }));

  const goSuggestThemes = async () => {
    const themes = userThemeInputs.map((t) => t.trim()).filter(Boolean);
    if (themes.length < 3) {
      setAiError("请至少填写 3 条大纲主题");
      return;
    }
    if (!title.trim()) {
      setAiError("请填写主题");
      return;
    }
    setAiError(null);
    setAiBusy(true);
    setAiBusyLabel("正在补全大纲…");
    try {
      const res = await suggestThemesMutation.mutateAsync({
        title: title.trim(),
        purposeZh: purpose.trim() || undefined,
        briefZh: briefZh.trim() || undefined,
        userThemes: themes,
      });
      if (res.polishedTitle?.trim()) setTitle(res.polishedTitle.trim());
      const userRows: ThemeRow[] = themes.map((t, i) => ({
        id: newThemeId("u", i),
        title: t,
        source: "user",
        selected: true,
      }));
      const aiRows: ThemeRow[] = (res.suggestedThemes || []).slice(0, 4).map((t, i) => ({
        id: t.id || newThemeId("ai", i),
        title: t.title,
        source: "ai",
        selected: true,
      }));
      setThemeRows([...userRows, ...aiRows]);
      setStep("themes");
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : "大纲补全失败");
    } finally {
      setAiBusy(false);
    }
  };

  const generateOutlineWithAi = async () => {
    const themes = confirmedThemes();
    if (themes.length < 3) {
      setAiError("请至少勾选 3 条大纲主题");
      return;
    }
    if (pageCount == null || pageCount < PLATFORM_HTML_PPT_PAGE_MIN) {
      setAiError(`请先选择页数（最少 ${PLATFORM_HTML_PPT_PAGE_MIN} 页）`);
      return;
    }
    if (!window.confirm(`将扣 ${outlineCost} 积分（${pageCount}×${perPageCost}，只收这一次）。确认生成？`)) {
      return;
    }
    setAiError(null);
    setAiBusy(true);
    const waitStartedAt = Date.now();
    setAiBusyLabel(formatWaitLabel("正在入队", 0));
    try {
      const enqueued = await generateOutlineMutation.mutateAsync({
        title: title.trim(),
        purposeZh: purpose.trim() || undefined,
        pageCount,
        styleId,
        briefZh: briefZh.trim() || undefined,
        confirmedThemes: themes,
      });
      setAiCost(typeof enqueued.cost === "number" ? enqueued.cost : outlineCost);
      setAiBusyLabel(formatWaitLabel("后台生成页面清单", Date.now() - waitStartedAt));
      const j = await pollJobUntilTerminal(enqueued.jobId, {
        intervalMs: 2500,
        maxWaitMs: 24 * 60_000,
        adaptiveBackoffAfterAttempts: 36,
        maxIntervalMs: 8000,
        onPoll: ({ status, elapsedMs }) => {
          setAiBusyLabel(
            formatWaitLabel(status === "queued" ? "排队中" : "生成中", elapsedMs),
          );
        },
      });
      if (j.status === "failed") throw new Error(j.error || "清单生成失败");
      const out =
        j.output && typeof j.output === "object" && !Array.isArray(j.output)
          ? (j.output as { pages?: HtmlPptPage[]; deckTitle?: string; summary?: string; cost?: number })
          : {};
      let nextPages = normalizeHtmlPptPages(Array.isArray(out.pages) ? out.pages : []);
      if (nextPages.length < pageCount) {
        throw new Error(`返回页数不足（${nextPages.length}/${pageCount}）`);
      }
      if (out.deckTitle?.trim()) setTitle(out.deckTitle.trim());
      setAiSummary(out.summary || null);
      if (typeof out.cost === "number") setAiCost(out.cost);

      if (enableSlideImages) {
        const imgStartedAt = Date.now();
        setAiBusyLabel(formatWaitLabel("正在生成插图", 0));
        const indices = [0, Math.min(2, nextPages.length - 1), Math.min(4, nextPages.length - 1)].filter(
          (v, i, a) => a.indexOf(v) === i,
        );
        for (const idx of indices) {
          const page = nextPages[idx];
          if (!page) continue;
          setAiBusyLabel(formatWaitLabel("正在生成插图", Date.now() - imgStartedAt));
          try {
            const img = await slideImageMutation.mutateAsync({
              deckTitle: title.trim(),
              templateId: imageTemplateId === "auto" ? null : imageTemplateId,
              styleId,
              page: {
                title: page.title,
                subtitle: page.subtitle,
                bullets: page.bullets,
                kpi: page.kpi,
                note: page.note,
                viz: page.viz,
                series: page.series,
                themeId: page.themeId,
                themeTitle: page.themeTitle,
                highlight: page.highlight,
              },
            });
            nextPages = nextPages.map((p, i) =>
              i === idx ? { ...p, imageUrl: img.imageUrl } : p,
            );
          } catch {
            /* 插图失败不阻断清单 */
          }
        }
      }

      setPages(nextPages);
      setStep("outline");
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "清单生成失败";
      setAiError(
        /Unexpected end of JSON|JSON\.parse|截断|页数不足|不完整/i.test(raw)
          ? "清单输出不完整。请减少页数后重试，或稍后再试。"
          : raw,
      );
    } finally {
      setAiBusy(false);
      setAiBusyLabel("处理中…");
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

  const updateSeries = (pageIndex: number, seriesIndex: number, patch: { label?: string; value?: number }) => {
    setPages((prev) =>
      prev.map((p, i) => {
        if (i !== pageIndex) return p;
        const series = [...(p.series || [])];
        const cur = series[seriesIndex] || { label: "", value: 0 };
        series[seriesIndex] = {
          label: patch.label != null ? patch.label : cur.label,
          value: patch.value != null ? patch.value : cur.value,
        };
        return { ...p, series };
      }),
    );
  };

  const patchOnePage = async (index: number) => {
    const note = (patchNotes[index] || "").trim();
    if (note.length < 2) {
      setAiError("请先填写本页修改说明");
      return;
    }
    if (!window.confirm(`单页重修将扣 ${patchCost} 积分。确认？`)) return;
    const page = pages[index];
    if (!page) return;
    setAiError(null);
    setAiBusy(true);
    setAiBusyLabel(`正在重修第 ${index + 1} 页…`);
    try {
      const res = await patchPageMutation.mutateAsync({
        title: title.trim(),
        purposeZh: purpose.trim() || undefined,
        briefZh: briefZh.trim() || undefined,
        styleId,
        page: {
          title: page.title,
          subtitle: page.subtitle,
          bullets: page.bullets,
          kpi: page.kpi,
          note: page.note,
          viz: page.viz,
          series: page.series,
          themeId: page.themeId,
          themeTitle: page.themeTitle,
          highlight: page.highlight,
          imageUrl: page.imageUrl,
        },
        pageIndex: index,
        totalPages: Math.max(PLATFORM_HTML_PPT_PAGE_MIN, pages.length),
        patchNote: note,
        confirmedThemes: confirmedThemes().length >= 3 ? confirmedThemes() : undefined,
      });
      updatePage(index, res.page);
      if (typeof res.cost === "number") setAiCost((c) => (c || 0) + res.cost);
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : "单页重修失败");
    } finally {
      setAiBusy(false);
    }
  };

  const generateFromOutline = () => {
    const normalized = normalizeHtmlPptPages(pages);
    if (normalized.length < PLATFORM_HTML_PPT_PAGE_MIN) {
      setAiError(`清单至少 ${PLATFORM_HTML_PPT_PAGE_MIN} 页`);
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
        pages: normalized.length
          ? normalized
          : buildDefaultHtmlPptPages(title, pageCount ?? PLATFORM_HTML_PPT_PAGE_MIN, purpose, styleId),
      });
    const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title.slice(0, 24).replace(/\s+/g, "-") || "website-ppt"}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadPptx = async () => {
    const normalized = normalizeHtmlPptPages(pages);
    const deckPages = normalized.length
      ? normalized
      : buildDefaultHtmlPptPages(title, pageCount ?? PLATFORM_HTML_PPT_PAGE_MIN, purpose, styleId);
    const deck = {
      title,
      styleId,
      purposeZh: purpose,
      pages: deckPages,
    };
    setAiError(null);
    setAiBusy(true);
    setAiBusyLabel("正在导出可编辑 PPTX…");
    try {
      const imageUrls = listHtmlPptPptxImageUrls(deck);
      let imageDataByUrl: Record<string, string> = {};
      if (imageUrls.length) {
        setAiBusyLabel(`正在载入插图（${imageUrls.length}）…`);
        const resolved = await resolvePptxImagesMutation.mutateAsync({ urls: imageUrls });
        imageDataByUrl = resolved.imageDataByUrl || {};
        const missing = imageUrls.filter((u) => !imageDataByUrl[u]);
        if (missing.length) {
          throw new Error("部分插图未能载入，请重试导出");
        }
      }

      let styleBgDataUrl: string | undefined;
      try {
        const bgPath = HTML_PPT_STYLES[styleId]?.bgUrl;
        if (bgPath && typeof window !== "undefined") {
          const abs = new URL(bgPath, window.location.origin).toString();
          const resp = await fetch(abs);
          if (resp.ok) {
            const blob = await resp.blob();
            styleBgDataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ""));
              reader.onerror = () => reject(new Error("叠底图读取失败"));
              reader.readAsDataURL(blob);
            });
          }
        }
      } catch {
        /* 叠底可选 */
      }

      setAiBusyLabel("正在写入 PPTX…");
      await downloadHtmlPptPptx(deck, undefined, { imageDataByUrl, styleBgDataUrl });
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : "PPTX 导出失败");
    } finally {
      setAiBusy(false);
    }
  };

  const rebuildLocalFree = () => {
    if (pageCount == null || !pageReady) {
      setAiError(`请先选择页数（最少 ${PLATFORM_HTML_PPT_PAGE_MIN}）`);
      return;
    }
    setPages(buildDefaultHtmlPptPages(title, pageCount, purpose, styleId));
    setAiSummary(null);
    setAiCost(null);
    setStep("outline");
  };

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-4">
      <div>
        <div className="text-sm font-semibold text-white/90">动效PPT生成演示</div>
        <p className="mt-1 text-[11px] leading-relaxed text-white/50">
          先填主题与 ≥3 条大纲 → 免费补全候选 → 勾选后按页生成（{perPageCost} 积分/页，整次只扣一次）。
          SVG/表格动效保留；插图默认开，且必须套版式模板（可选或自动判断）。
          改数字请直接改清单再刷新预览（免费）。
        </p>
      </div>

      <div className="inline-flex flex-wrap gap-1 rounded-xl border border-white/10 bg-black/40 p-0.5">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={busy}
            onClick={() => setStep(s.id)}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold ${
              step === s.id ? "bg-white/15 text-white" : "text-white/45 hover:text-white/70"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {step === "setup" ? (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-[11px] text-white/60">
              主题（必填）
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
              />
            </label>
          </div>

          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/35">风格</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {styleList.map(([id, meta]) => (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  onClick={() => setStyleId(id)}
                  className={`overflow-hidden rounded-xl border text-left disabled:opacity-40 ${
                    styleId === id ? "border-emerald-400/55 ring-1 ring-emerald-400/30" : "border-white/10"
                  }`}
                >
                  <img src={meta.previewUrl} alt={meta.labelZh} className="aspect-video w-full object-cover" />
                  <div className="px-2 py-1.5 text-[11px] font-semibold text-white/90">{meta.labelZh}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/25 p-3 space-y-2">
            <label className="flex items-center gap-2 text-[11px] text-white/70">
              <input
                type="checkbox"
                checked={enableSlideImages}
                disabled={busy}
                onChange={(e) => setEnableSlideImages(e.target.checked)}
              />
              默认生成关键页插图（版式模板 + 页内容锁定；SVG/表格仍保留）
            </label>
            <label className="block text-[11px] text-white/60">
              插图版式模板
              <select
                disabled={busy || !enableSlideImages}
                value={imageTemplateId}
                onChange={(e) => setImageTemplateId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-[12px] text-white"
              >
                <option value="auto">自动判断（按页内容选版式）</option>
                {INFOGRAPHIC_NOTE_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.labelZh}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] text-white/60">
              大纲主题（至少 3 条，写在正文逻辑里的大标题）
            </div>
            <div className="space-y-1.5">
              {userThemeInputs.map((t, i) => (
                <div key={`ut-${i}`} className="flex gap-2">
                  <input
                    disabled={busy}
                    value={t}
                    onChange={(e) =>
                      setUserThemeInputs((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                    }
                    placeholder={`大纲 ${i + 1}`}
                    className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-[12px] text-white"
                  />
                  <button
                    type="button"
                    disabled={busy || userThemeInputs.length <= 3}
                    onClick={() => setUserThemeInputs((prev) => prev.filter((_, j) => j !== i))}
                    className="text-[10px] text-white/40 disabled:opacity-30"
                  >
                    删
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={busy || userThemeInputs.length >= 8}
                onClick={() => setUserThemeInputs((prev) => [...prev, ""])}
                className="text-[10px] text-cyan-200/70 underline-offset-2 hover:underline disabled:opacity-40"
              >
                + 加一条大纲
              </button>
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] text-white/60">
              页数（必选 · 最少 {PLATFORM_HTML_PPT_PAGE_MIN} · {perPageCost} 积分/页）
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Array.from(
                { length: PLATFORM_HTML_PPT_PAGE_MAX - PLATFORM_HTML_PPT_PAGE_MIN + 1 },
                (_, i) => i + PLATFORM_HTML_PPT_PAGE_MIN,
              ).map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={busy}
                  onClick={() => setPageCount(n)}
                  className={`min-w-[2.5rem] rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-40 ${
                    pageCount === n
                      ? "border-emerald-400/55 bg-emerald-500/20 text-emerald-50"
                      : "border-white/15 bg-black/40 text-white/70"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            {pageCount != null && outlineCost != null ? (
              <p className="mt-1.5 text-[10px] text-emerald-200/70">
                生成页面内容：{outlineCost} 积分（{pageCount}×{perPageCost}，只扣这一次；补大纲免费）
              </p>
            ) : (
              <p className="mt-1.5 text-[10px] text-amber-200/80">请先点选页数</p>
            )}
          </div>

          <label className="block text-[11px] text-white/60">
            补充背景 / 数据口径
            <textarea
              disabled={busy}
              value={briefZh}
              onChange={(e) => setBriefZh(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !title.trim() || !userThemesReady || !pageReady}
              onClick={() => void goSuggestThemes()}
              className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-[12px] font-semibold text-emerald-50 disabled:opacity-40"
            >
              {aiBusy ? aiBusyLabel : "免费补全大纲并进入勾选"}
            </button>
            <button
              type="button"
              disabled={busy || !title.trim() || !pageReady}
              onClick={rebuildLocalFree}
              className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-[12px] font-semibold text-white/70 disabled:opacity-40"
            >
              仅用模板骨架（免费）
            </button>
          </div>
        </div>
      ) : null}

      {step === "themes" ? (
        <div className="space-y-3">
          <p className="text-[11px] text-white/50">
            勾选本次要讲的大纲（建议 4–8 条）。未勾选不会进入生成。可改名。
          </p>
          <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
            {themeRows.map((row, i) => (
              <label
                key={row.id}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/35 px-3 py-2"
              >
                <input
                  type="checkbox"
                  checked={row.selected}
                  disabled={busy}
                  onChange={(e) =>
                    setThemeRows((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, selected: e.target.checked } : r)),
                    )
                  }
                />
                <span className="text-[10px] text-white/35 w-10">{row.source === "user" ? "我的" : "建议"}</span>
                <input
                  disabled={busy}
                  value={row.title}
                  onChange={(e) =>
                    setThemeRows((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)),
                    )
                  }
                  className="flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[12px] text-white"
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || confirmedThemes().length < 3}
              onClick={() => void generateOutlineWithAi()}
              className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-[12px] font-semibold text-emerald-50 disabled:opacity-40"
            >
              {aiBusy
                ? aiBusyLabel
                : `确认大纲并生成页面（${outlineCost ?? "—"} 积分）`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep("setup")}
              className="rounded-lg border border-white/20 px-3 py-2 text-[12px] text-white/60"
            >
              返回设定
            </button>
          </div>
        </div>
      ) : null}

      {step === "outline" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-white/35">
              页面清单（可改标题/要点/数字/viz · 刷新预览免费）
              {aiCost != null ? <span className="ml-2 text-emerald-300/80">· 已扣 {aiCost} 点</span> : null}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`整份重跑将再扣 ${outlineCost} 积分。仍要继续？`)) {
                  void generateOutlineWithAi();
                }
              }}
              className="text-[10px] text-amber-200/80 underline-offset-2 hover:underline disabled:opacity-40"
            >
              整份重跑（再收费）
            </button>
          </div>
          {aiSummary ? (
            <p className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-[11px] text-white/55">
              {aiSummary}
            </p>
          ) : null}
          <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
            {pages.map((p, i) => (
              <div key={`page-${i}`} className="rounded-xl border border-white/10 bg-black/35 p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] text-white/35">P{i + 1}</span>
                  {p.themeTitle ? (
                    <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] text-cyan-100">
                      {p.themeTitle}
                    </span>
                  ) : null}
                  <select
                    disabled={busy}
                    value={p.viz || ""}
                    onChange={(e) =>
                      updatePage(i, { viz: (e.target.value || undefined) as HtmlPptVizKind | undefined })
                    }
                    className="rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-[10px] text-violet-100"
                  >
                    <option value="">自动</option>
                    {HTML_PPT_VIZ_KINDS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
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
                </div>
                {(p.bullets || []).map((b, bi) => (
                  <input
                    key={`b-${i}-${bi}`}
                    disabled={busy}
                    value={b}
                    onChange={(e) => updateBullet(i, bi, e.target.value)}
                    className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white/75"
                  />
                ))}
                {p.series?.length ? (
                  <div className="space-y-1">
                    <div className="text-[10px] text-white/35">图表数据（可改）</div>
                    {p.series.map((s, si) => (
                      <div key={`s-${i}-${si}`} className="flex gap-2">
                        <input
                          disabled={busy}
                          value={s.label}
                          onChange={(e) => updateSeries(i, si, { label: e.target.value })}
                          className="flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white/75"
                        />
                        <input
                          disabled={busy}
                          type="number"
                          value={s.value}
                          onChange={(e) => updateSeries(i, si, { value: Number(e.target.value) || 0 })}
                          className="w-24 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-emerald-100"
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2 items-center">
                  <input
                    disabled={busy}
                    value={patchNotes[i] || ""}
                    onChange={(e) => setPatchNotes((prev) => ({ ...prev, [i]: e.target.value }))}
                    placeholder="本页修改说明（结构跑题时再用）"
                    className="min-w-[180px] flex-1 rounded-md border border-amber-400/20 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-50/90"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void patchOnePage(i)}
                    className="text-[10px] text-amber-200/80 underline-offset-2 hover:underline disabled:opacity-40"
                  >
                    按页重修（{patchCost} 积分）
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || pages.length < PLATFORM_HTML_PPT_PAGE_MIN}
            onClick={generateFromOutline}
            className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-[12px] font-semibold text-emerald-50 disabled:opacity-40"
          >
            确认清单并生成预览（免费重渲）
          </button>
        </div>
      ) : null}

      {step === "export" ? (
        <div className="space-y-3">
          <p className="text-[11px] text-white/50">
            数字写错：点「返回改清单」免费改 → 再刷新预览。空格=下一步动效，←→=翻页。HTML
            适合投屏；PPTX 保留同款配色与插图（无分步动效），便于本地改隐私数据与措辞。
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep("outline")}
              className="rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-[12px] text-sky-100"
            >
              返回改清单（不扣费）
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={generateFromOutline}
              className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-[12px] font-semibold text-white"
            >
              刷新预览
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={download}
              className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-[12px] font-semibold text-emerald-50"
            >
              导出 HTML
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void downloadPptx()}
              className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-[12px] font-semibold text-amber-50"
            >
              导出可编辑 PPTX
            </button>
            {previewUrl ? (
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-[12px] text-sky-100"
              >
                新窗口全屏预览
              </a>
            ) : null}
          </div>
          {previewUrl ? (
            <iframe title="ppt-preview" src={previewUrl} className="h-[420px] w-full rounded-xl border border-white/10 bg-black" />
          ) : null}
        </div>
      ) : null}

      {aiError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
          {aiError}
        </div>
      ) : null}
    </div>
  );
}
