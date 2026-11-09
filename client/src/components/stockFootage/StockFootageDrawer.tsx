/**
 * 共用「找素材」右侧抽屉（MV 镜头 / 数字人段落 / 营销段落 / 漫剧空镜共用）。
 * 关键词（可编辑，打开时按镜头描述自动生成）→ 筛选（画幅、至少 N 秒）→ 候选单选 →
 * 抽屉内预览 + 入点/出点 → 「采用并绑定」：服务端把素材存入本人空间后 onPick({asset,inSec,outSec})。
 *
 * - 采用沿用 useStockFootageAdoption 的本机待办与同编号续做；onPick 失败时保留已采用资产，重试只重新绑定、不重复保存。
 * - onPick 成功后抽屉不自动关闭，由业务方决定（通常在 onPick 里把 open 置 false）。
 * - 界面不显示素材来源、作者、许可等信息，只显示时长、尺寸、画幅。
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { AlertTriangle, Film, Image as ImageIcon, Loader2, Pause, Play, RotateCw, Search, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  assertStockUsageAllowed,
  type StockFootageAssetView,
  type StockFootageCandidate,
  type StockFootageOrientation,
  type StockFootagePurpose,
  type StockFootageUsage,
} from "@shared/stockFootage";
import { STOCK_TRIM_MIN_SEC, clampStockTrim, type StockTrim } from "@shared/stockFootageTrim";
import {
  buildStockPick,
  candidateShortBySec,
  defaultMinDurationSec,
  fallbackQueryFromText,
  fmtDuration,
  fmtSec,
  keywordSourceText,
  orientationLabel,
  pendingMatchesContext,
  type PendingAdoption,
} from "./stockFootageModel";
import { useStockFootageAdoption } from "./useStockFootageAdoption";

export type StockFootagePick = { asset: StockFootageAssetView; inSec: number; outSec: number };
export type StockFootageDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** 如「为镜头02找素材」「为第 2 段找素材」 */
  title: string;
  purpose: StockFootagePurpose;
  /** 默认同 StockFootagePanel：漫剧 reference，其余 insert。 */
  usage?: StockFootageUsage;
  kind?: "video" | "photo";
  orientation?: StockFootageOrientation;
  /** 镜头/段落时长：短于它的候选保留但标「短于镜头 N 秒」；裁剪窗口默认等于它。 */
  targetDurationSec?: number;
  /** 镜头/段落中文描述：打开时据此生成可编辑关键词。 */
  sourceText?: string;
  /** 有值时优先于 sourceText。 */
  initialQuery?: string;
  context?: { projectId?: string; shotId?: string; segmentId?: string; note?: string };
  /** 默认「采用并绑定」 */
  confirmLabel?: string;
  onPick: (pick: StockFootagePick) => void | Promise<void>;
};

const TRIM_STEP_SEC = 0.1;

const candidateKey = (c: Pick<StockFootageCandidate, "kind" | "providerAssetId">) => `${c.kind}-${c.providerAssetId}`;

export function StockFootageDrawer(props: StockFootageDrawerProps) {
  // 每次打开重新挂载：关键词、筛选、选中与裁点都从当前镜头/段落重新开始。
  if (!props.open) return null;
  // 挂到 body：营销/数字人等面板的祖先带 backdrop-filter / transform，会把 fixed 定位困在面板内，
  // 抽屉被画到视口外（线上 11-09 实测：营销「找素材」DOM 有 18 个候选但画面空白）。
  if (typeof document === "undefined") return <StockFootageDrawerBody {...props} />;
  return createPortal(<StockFootageDrawerBody {...props} />, document.body);
}

function StockFootageDrawerBody(props: StockFootageDrawerProps) {
  const { onClose, purpose, context } = props;
  const titleId = useId();
  const kind = props.kind ?? "video";
  const usage: StockFootageUsage = props.usage ?? (purpose === "manhua" ? "reference" : "insert");
  const targetSec = props.targetDurationSec && Number.isFinite(props.targetDurationSec) && props.targetDurationSec > 0 ? props.targetDurationSec : undefined;
  const usageError = useMemo(() => {
    try {
      assertStockUsageAllowed(purpose, usage);
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  }, [purpose, usage]);

  // ── 关键词：initialQuery 优先；否则按镜头描述生成，失败退回原文 ──
  const initialQuery = props.initialQuery?.trim().slice(0, 100) ?? "";
  const keywordText = initialQuery ? "" : keywordSourceText(props.sourceText);
  const [draftQuery, setDraftQuery] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const userEditedRef = useRef(Boolean(initialQuery));
  const suggest = trpc.stockFootage.suggestKeywords.useQuery(
    { text: keywordText, purpose, ...(props.orientation ? { orientation: props.orientation } : {}) },
    { enabled: keywordText.length > 0 && !usageError, retry: false, staleTime: Infinity, refetchOnWindowFocus: false }
  );
  const suggestedZh = suggest.data?.queryZh?.trim() ?? "";
  useEffect(() => {
    if (userEditedRef.current || !keywordText) return;
    if (!suggest.data && !suggest.isError) return;
    const next = suggest.data?.query?.trim().slice(0, 100) || fallbackQueryFromText(props.sourceText);
    if (!next) return;
    userEditedRef.current = true;
    setDraftQuery(next);
    setQuery(next);
  }, [keywordText, props.sourceText, suggest.data, suggest.isError]);
  const keywordsLoading = keywordText.length > 0 && suggest.isLoading && !query;

  // ── 筛选 ──
  const [orientation, setOrientation] = useState<StockFootageOrientation | undefined>(props.orientation);
  const [minDurationSec, setMinDurationSec] = useState<number | undefined>(() => (kind === "video" ? defaultMinDurationSec(targetSec) : undefined));
  const [page, setPage] = useState(1);

  const search = trpc.stockFootage.search.useQuery(
    {
      query,
      kind,
      orientation,
      page,
      perPage: 18,
      purpose,
      ...(kind === "video" && minDurationSec && minDurationSec >= 1 ? { minDurationSec: Math.min(600, Math.floor(minDurationSec)) } : {}),
    },
    { enabled: query.length > 0 && !usageError, staleTime: 5 * 60_000, retry: false }
  );
  const candidates = search.data?.candidates ?? [];

  // ── 选中与裁点 ──
  const [selected, setSelected] = useState<StockFootageCandidate | null>(null);
  const [metaDurationSec, setMetaDurationSec] = useState<number | undefined>(undefined);
  const [trim, setTrim] = useState<StockTrim>({ inSec: 0, outSec: 0 });
  const sourceSec = selected?.durationSec ?? metaDurationSec ?? 0;
  const isVideo = selected?.kind === "video";
  const canTrim = isVideo && sourceSec > 0;

  const choose = (c: StockFootageCandidate) => {
    setSelected(c);
    setPlaying(false);
    setMetaDurationSec(undefined);
    const r = clampStockTrim({ sourceSec: c.durationSec ?? 0, targetSec, inSec: 0 });
    setTrim({ inSec: r.inSec, outSec: r.outSec });
  };

  // ── 预览播放器：只在入点—出点之间循环 ──
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const trimRef = useRef(trim);
  trimRef.current = trim;
  const seek = (sec: number) => {
    const v = videoRef.current;
    if (v && Number.isFinite(sec)) v.currentTime = Math.max(0, sec);
  };

  const setInPoint = (value: number) => {
    const out = trim.outSec;
    const wantedIn = Math.min(value, out - STOCK_TRIM_MIN_SEC);
    const r = clampStockTrim({ sourceSec, targetSec: Math.max(STOCK_TRIM_MIN_SEC, out - wantedIn), inSec: wantedIn });
    setTrim({ inSec: r.inSec, outSec: r.outSec });
    seek(r.inSec);
  };
  const setOutPoint = (value: number) => {
    const wantedOut = Math.max(value, trim.inSec + STOCK_TRIM_MIN_SEC);
    const r = clampStockTrim({ sourceSec, targetSec: wantedOut - trim.inSec, inSec: trim.inSec });
    setTrim({ inSec: r.inSec, outSec: r.outSec });
    videoRef.current?.pause();
    seek(Math.max(r.inSec, r.outSec - TRIM_STEP_SEC));
  };
  const resetWindow = () => {
    const r = clampStockTrim({ sourceSec, targetSec, inSec: trim.inSec });
    setTrim({ inSec: r.inSec, outSec: r.outSec });
    seek(r.inSec);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      const t = trimRef.current;
      if (canTrim && (v.currentTime < t.inSec || v.currentTime >= t.outSec - 0.05)) v.currentTime = t.inSec;
      void v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  };

  // ── 采用 ──
  const adoption = useStockFootageAdoption({
    purpose,
    filterPending: useCallback((p: PendingAdoption) => pendingMatchesContext(p, purpose, context), [purpose, context]),
  });
  const [adopted, setAdopted] = useState<{ key: string; asset: StockFootageAssetView } | null>(null);
  const [binding, setBinding] = useState(false);
  const busy = adoption.isAdopting || binding || adoption.busyId !== null;

  const bind = async (pick: StockFootagePick) => {
    setBinding(true);
    try {
      await props.onPick(pick);
      return true;
    } catch (error) {
      toast.error((error as { message?: string })?.message || "绑定失败，请重试");
      return false;
    } finally {
      setBinding(false);
    }
  };

  const confirm = async () => {
    if (!selected || busy) return;
    const key = candidateKey(selected);
    const pickTrim = selected.kind === "video" && trim.outSec > trim.inSec ? trim : undefined;
    // onPick 曾失败：素材已在本人空间，直接重新绑定，不再发起新的保存。
    let asset = adopted?.key === key ? adopted.asset : null;
    if (!asset) {
      asset = await adoption.startAdoption(selected, { usage, orientation: orientation ?? props.orientation, context: context ?? {}, ...(pickTrim ? { trim: pickTrim } : {}) });
      if (!asset) return;
      setAdopted({ key, asset });
    }
    await bind(buildStockPick(asset, pickTrim, targetSec));
  };

  const resume = async (p: PendingAdoption) => {
    const asset = await adoption.resumeAdoption(p);
    if (asset) await bind(buildStockPick(asset, p.trim, targetSec));
  };

  // ── 抽屉外壳：Esc 关闭，打开时聚焦、关闭后归还焦点 ──
  const panelRef = useRef<HTMLElement | null>(null);
  // 保存/绑定进行中不允许关闭：否则旧的 onPick 会在抽屉关闭后仍写入绑定，并关掉用户新开的抽屉。
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const guardedClose = () => {
    if (busyRef.current) {
      toast.info("正在保存素材，完成后会自动绑定，请稍候");
      return;
    }
    onClose();
  };
  const onCloseRef = useRef(guardedClose);
  onCloseRef.current = guardedClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  const submitQuery = () => {
    userEditedRef.current = true;
    setPage(1);
    setQuery(draftQuery.trim().slice(0, 100));
  };

  const errorMessage = (search.error as { message?: string } | null)?.message;
  const confirmLabel = props.confirmLabel ?? "采用并绑定";
  const shortBy = selected ? candidateShortBySec(selected, targetSec) : 0;
  const pct = (sec: number) => (sourceSec > 0 ? `${Math.min(100, Math.max(0, (sec / sourceSec) * 100))}%` : "0%");

  return (
    <div className="fixed inset-0 z-[90] flex justify-end" data-stock-footage-drawer>
      <button type="button" tabIndex={-1} aria-label="关闭找素材" className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[1px]" onClick={guardedClose} />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-[34rem] flex-col border-l border-white/10 bg-[#0e1016] text-sm text-white shadow-2xl outline-none"
      >
        <header className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-medium">{props.title}</h2>
            <div className="flex flex-wrap items-center gap-1.5 text-xs opacity-70">
              <span>{kind === "video" ? "视频素材" : "照片素材"}</span>
              {targetSec ? <span>· 镜头时长 {fmtSec(targetSec)}</span> : null}
              {usage === "reference" && <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-sky-200">仅参考，不入片</span>}
              {usage === "empty_shot" && <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-violet-200">空镜·无人物</span>}
            </div>
          </div>
          <button type="button" aria-label="关闭" disabled={busy} onClick={guardedClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </header>

        {usageError ? (
          <div className="m-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-200">{usageError}</div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <form
                className="space-y-1"
                onSubmit={e => {
                  e.preventDefault();
                  submitQuery();
                }}
              >
                <label htmlFor={`${titleId}-q`} className="text-xs opacity-70">关键词（可修改）</label>
                <div className="flex gap-2">
                  <input
                    id={`${titleId}-q`}
                    value={draftQuery}
                    onChange={e => {
                      userEditedRef.current = true;
                      setDraftQuery(e.target.value);
                    }}
                    maxLength={100}
                    placeholder={keywordsLoading ? "正在根据描述生成关键词…" : "如 city night rain"}
                    className="min-h-11 min-w-0 flex-1 rounded-md border border-white/15 bg-black/30 px-3"
                  />
                  <button type="submit" disabled={!draftQuery.trim()} className="flex min-h-11 shrink-0 items-center gap-1 rounded-md bg-white/15 px-3 hover:bg-white/20 disabled:opacity-40">
                    <Search className="h-4 w-4" />搜索
                  </button>
                </div>
                {keywordsLoading && <div className="flex items-center gap-1 text-xs opacity-70"><Loader2 className="h-3 w-3 animate-spin" />正在根据描述生成关键词…</div>}
                {suggestedZh && <div className="text-xs opacity-60">检索意图：{suggestedZh}</div>}
              </form>

              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="opacity-70">画幅</span>
                  <select
                    value={orientation ?? ""}
                    onChange={e => {
                      setOrientation((e.target.value || undefined) as StockFootageOrientation | undefined);
                      setPage(1);
                    }}
                    className="min-h-11 rounded-md border border-white/15 bg-black/30 px-2 text-sm"
                  >
                    <option value="">不限画幅</option>
                    <option value="landscape">横屏</option>
                    <option value="portrait">竖屏</option>
                    <option value="square">方形</option>
                  </select>
                </label>
                {kind === "video" && (
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="opacity-70">至少（秒，留空不限）</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={600}
                      step={1}
                      value={minDurationSec ?? ""}
                      onChange={e => {
                        const n = Number(e.target.value);
                        setMinDurationSec(e.target.value === "" || !Number.isFinite(n) || n < 1 ? undefined : Math.min(600, Math.floor(n)));
                        setPage(1);
                      }}
                      className="min-h-11 w-28 rounded-md border border-white/15 bg-black/30 px-2 text-sm"
                    />
                  </label>
                )}
              </div>

              {adoption.pending.length > 0 && (
                <div className="rounded-md border border-white/10 p-2">
                  <div className="mb-1 text-xs opacity-70">上次未完成的采用（可继续，不会重复保存）</div>
                  <ul className="flex flex-col gap-2">
                    {adoption.pending.map(p => (
                      <li key={p.requestId} className="flex items-center gap-2 rounded bg-white/5 px-2 py-1">
                        {p.previewImageUrl && <img src={p.previewImageUrl} alt="" className="h-9 w-14 rounded object-cover" />}
                        <span className="flex-1 text-xs opacity-80">
                          {adoption.pendingStatus[p.requestId] === "succeeded" ? "已完成，待绑定" : adoption.pendingStatus[p.requestId] === "running" ? "处理中" : "待继续"}
                        </span>
                        <button type="button" disabled={busy} className="flex min-h-11 items-center gap-1 rounded-md bg-white/10 px-3 text-xs disabled:opacity-40" onClick={() => void resume(p)}>
                          {adoption.busyId === p.requestId ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
                          {adoption.pendingStatus[p.requestId] === "succeeded" ? "绑定" : "继续"}
                        </button>
                        <button type="button" disabled={adoption.busyId === p.requestId} className="min-h-11 px-2 text-xs opacity-60 disabled:opacity-30" onClick={() => adoption.removePending(p.requestId)}>移除</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selected && (
                <div className="space-y-2 rounded-md border border-white/10 bg-black/30 p-2" aria-live="polite">
                  <div className="relative aspect-video overflow-hidden rounded bg-black">
                    {isVideo && selected.previewVideoUrl ? (
                      <video
                        key={candidateKey(selected)}
                        ref={videoRef}
                        src={selected.previewVideoUrl}
                        poster={selected.previewImageUrl}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-contain"
                        onLoadedMetadata={e => {
                          const v = e.currentTarget;
                          if (!selected.durationSec && Number.isFinite(v.duration) && v.duration > 0) {
                            setMetaDurationSec(v.duration);
                            const r = clampStockTrim({ sourceSec: v.duration, targetSec, inSec: 0 });
                            setTrim({ inSec: r.inSec, outSec: r.outSec });
                          }
                          v.currentTime = trimRef.current.inSec;
                        }}
                        onTimeUpdate={e => {
                          const v = e.currentTarget;
                          const t = trimRef.current;
                          if (t.outSec > t.inSec && !v.paused && v.currentTime >= t.outSec) v.currentTime = t.inSec;
                        }}
                        onPlay={() => setPlaying(true)}
                        onPause={() => setPlaying(false)}
                        onEnded={() => setPlaying(false)}
                      />
                    ) : (
                      <img src={selected.previewImageUrl} alt="" className="h-full w-full object-contain" />
                    )}
                    <span className="absolute left-2 top-2 rounded bg-amber-500/90 px-2 py-0.5 text-xs font-medium text-black">正在预览候选，尚未替换</span>
                  </div>

                  {isVideo && selected.previewVideoUrl && (
                    <button type="button" onClick={togglePlay} className="flex min-h-11 items-center gap-1 rounded-md bg-white/10 px-3 hover:bg-white/15">
                      {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      {playing ? "暂停" : "播放选段"}
                    </button>
                  )}

                  {canTrim ? (
                    <div className="space-y-2">
                      <div className="relative h-2 rounded bg-white/10" aria-hidden="true">
                        <div className="absolute inset-y-0 rounded bg-emerald-400/70" style={{ left: pct(trim.inSec), width: `calc(${pct(trim.outSec)} - ${pct(trim.inSec)})` }} />
                      </div>
                      <label className="flex items-center gap-2 text-xs">
                        <span className="w-10 shrink-0 opacity-70">入点</span>
                        <input
                          type="range"
                          min={0}
                          max={sourceSec}
                          step={TRIM_STEP_SEC}
                          value={trim.inSec}
                          onChange={e => setInPoint(Number(e.target.value))}
                          aria-valuetext={fmtSec(trim.inSec)}
                          className="h-11 flex-1 accent-emerald-400"
                        />
                        <span className="w-12 shrink-0 text-right tabular-nums">{fmtSec(trim.inSec)}</span>
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <span className="w-10 shrink-0 opacity-70">出点</span>
                        <input
                          type="range"
                          min={0}
                          max={sourceSec}
                          step={TRIM_STEP_SEC}
                          value={trim.outSec}
                          onChange={e => setOutPoint(Number(e.target.value))}
                          aria-valuetext={fmtSec(trim.outSec)}
                          className="h-11 flex-1 accent-emerald-400"
                        />
                        <span className="w-12 shrink-0 text-right tabular-nums">{fmtSec(trim.outSec)}</span>
                      </label>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="opacity-80">选段 {fmtSec(trim.outSec - trim.inSec)} / 素材 {fmtSec(sourceSec)}</span>
                        {targetSec && Math.abs(trim.outSec - trim.inSec - Math.min(targetSec, sourceSec)) > 0.05 ? (
                          <button type="button" onClick={resetWindow} className="min-h-11 rounded-md bg-white/10 px-3 hover:bg-white/15">恢复为镜头时长</button>
                        ) : null}
                      </div>
                    </div>
                  ) : isVideo ? (
                    <div className="text-xs opacity-70">正在读取素材时长…</div>
                  ) : (
                    <div className="text-xs opacity-70">照片无需裁剪，将按 {fmtSec(targetSec ?? 3)} 静帧使用。</div>
                  )}
                  {shortBy > 0 && (
                    <div className="flex items-center gap-1 text-xs text-amber-200">
                      <AlertTriangle className="h-3.5 w-3.5" />此素材短于镜头 {shortBy} 秒，将整段使用。
                    </div>
                  )}
                </div>
              )}

              {search.isFetching && <div className="flex items-center gap-2 opacity-70"><Loader2 className="h-4 w-4 animate-spin" />搜索中…</div>}
              {errorMessage && <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-red-200">{errorMessage}</div>}
              {!query && !keywordsLoading && <div className="opacity-70">输入关键词后搜索素材。</div>}
              {search.data && candidates.length === 0 && <div className="opacity-70">没有找到符合条件的素材，换个关键词或放宽画幅/时长试试。</div>}

              {candidates.length > 0 && (
                <div role="radiogroup" aria-label="候选素材" className="flex flex-col gap-2">
                  {candidates.map(c => {
                    const key = candidateKey(c);
                    const checked = selected ? candidateKey(selected) === key : false;
                    const short = candidateShortBySec(c, targetSec);
                    const shape = orientationLabel(c.width, c.height);
                    return (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        disabled={busy}
                        onClick={() => choose(c)}
                        className={`flex min-h-11 items-center gap-3 rounded-md border p-1.5 text-left disabled:opacity-60 ${checked ? "border-emerald-400 bg-emerald-400/10" : "border-white/10 hover:bg-white/5"}`}
                      >
                        <span className="relative block aspect-video w-28 shrink-0 overflow-hidden rounded bg-black/40">
                          <img src={c.previewImageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                          {c.kind === "video" && c.durationSec ? (
                            <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] tabular-nums">{fmtDuration(c.durationSec)}</span>
                          ) : null}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs">
                          <span className="flex items-center gap-1 opacity-80">
                            {c.kind === "video" ? <Film className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                            {c.kind === "video" ? "视频" : "照片"}
                            {shape ? ` · ${shape}` : ""}
                          </span>
                          <span className="tabular-nums opacity-60">{c.width}×{c.height}</span>
                          {short > 0 && <span className="text-amber-200">短于镜头 {short} 秒</span>}
                        </span>
                        <span aria-hidden="true" className={`mr-1 h-4 w-4 shrink-0 rounded-full border ${checked ? "border-emerald-400 bg-emerald-400" : "border-white/40"}`} />
                      </button>
                    );
                  })}
                </div>
              )}

              {search.data && (search.data.hasMore || page > 1) && (
                <div className="flex items-center justify-center gap-3">
                  <button type="button" disabled={page <= 1} className="min-h-11 rounded-md bg-white/10 px-3 disabled:opacity-40" onClick={() => setPage(p => p - 1)}>上一页</button>
                  <span className="opacity-70">第 {page} 页</span>
                  <button type="button" disabled={!search.data.hasMore} className="min-h-11 rounded-md bg-white/10 px-3 disabled:opacity-40" onClick={() => setPage(p => p + 1)}>换一批</button>
                </div>
              )}
            </div>

            <footer className="space-y-2 border-t border-white/10 px-4 py-3">
              {selected && !busy && <div className="text-xs text-amber-200">正在预览候选，尚未替换；点「{confirmLabel}」后才会替换当前画面。</div>}
              {busy && <div className="flex items-center gap-1 text-xs opacity-80"><Loader2 className="h-3 w-3 animate-spin" />{binding ? "正在绑定…" : "正在保存素材，完成后自动绑定…"}</div>}
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={guardedClose} className="min-h-11 rounded-md bg-white/10 px-4 hover:bg-white/15 disabled:opacity-40">取消</button>
                <button
                  type="button"
                  disabled={!selected || busy}
                  onClick={() => void confirm()}
                  className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-md bg-emerald-500 px-4 font-medium text-black hover:bg-emerald-400 disabled:opacity-40"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {confirmLabel}
                </button>
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

export default StockFootageDrawer;
