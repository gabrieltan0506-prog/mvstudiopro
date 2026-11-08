/**
 * 共用素材检索面板（MV / 数字人 / 营销 / 漫剧共用）。
 * 搜索 → 候选预览 → 采用（服务端下载入本人 GCS + 来源证据）→ onAdopted 交给业务方绑定。
 * 断点恢复：采用前先把 requestId 写进本机待办；断线/刷新后在「未完成的采用」里用同一编号继续，
 * 服务端幂等，不会重复入库。已采用素材可在「已采用」页直接复用，不重新下载。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, RotateCw, Check, Film, Image as ImageIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  STOCK_FOOTAGE_PURPOSE_LABEL,
  assertStockUsageAllowed,
  type StockFootageAssetView,
  type StockFootageCandidate,
  type StockFootageKind,
  type StockFootageOrientation,
  type StockFootagePurpose,
  type StockFootageUsage,
} from "@shared/stockFootage";

export type StockFootagePanelProps = {
  purpose: StockFootagePurpose;
  usage?: StockFootageUsage;
  defaultKind?: StockFootageKind;
  defaultOrientation?: StockFootageOrientation;
  minDurationSec?: number;
  maxDurationSec?: number;
  initialQuery?: string;
  context?: { projectId?: string; shotId?: string; segmentId?: string; note?: string };
  onAdopted: (asset: StockFootageAssetView) => void;
  compact?: boolean;
  className?: string;
};

type PendingAdoption = {
  requestId: string;
  providerAssetId: string;
  kind: StockFootageKind;
  purpose: StockFootagePurpose;
  usage: StockFootageUsage;
  orientation?: StockFootageOrientation;
  context: NonNullable<StockFootagePanelProps["context"]>;
  previewImageUrl?: string;
  startedAt: number;
};

const PENDING_KEY = "mvs.stockFootage.pending.v1";
const PENDING_MAX_AGE_MS = 7 * 24 * 3600_000;

function readPending(): PendingAdoption[] {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    const list = raw ? (JSON.parse(raw) as PendingAdoption[]) : [];
    return Array.isArray(list) ? list.filter(p => p && p.requestId && Date.now() - p.startedAt < PENDING_MAX_AGE_MS) : [];
  } catch {
    return [];
  }
}
function writePending(list: PendingAdoption[]) {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    /* 存储不可用时仅失去本机续做提示，服务端回执仍在 */
  }
}

function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

function fmtDuration(sec?: number) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}:${String(s).padStart(2, "0")}` : `${s}秒`;
}

export function StockFootagePanel(props: StockFootagePanelProps) {
  const usage: StockFootageUsage = props.usage ?? (props.purpose === "manhua" ? "reference" : "insert");
  const usageError = useMemo(() => {
    try {
      assertStockUsageAllowed(props.purpose, usage);
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  }, [props.purpose, usage]);

  const [tab, setTab] = useState<"search" | "adopted">("search");
  const [kind, setKind] = useState<StockFootageKind>(props.defaultKind ?? "video");
  const [orientation, setOrientation] = useState<StockFootageOrientation | undefined>(props.defaultOrientation);
  const [draftQuery, setDraftQuery] = useState(props.initialQuery ?? "");
  const [query, setQuery] = useState(props.initialQuery?.trim() ?? "");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAdoption[]>(() => (typeof window === "undefined" ? [] : readPending()));
  const utils = trpc.useUtils();

  const search = trpc.stockFootage.search.useQuery(
    {
      query,
      kind,
      orientation,
      page,
      perPage: props.compact ? 12 : 18,
      purpose: props.purpose,
      ...(kind === "video" && props.minDurationSec ? { minDurationSec: props.minDurationSec } : {}),
      ...(kind === "video" && props.maxDurationSec ? { maxDurationSec: props.maxDurationSec } : {}),
    },
    { enabled: tab === "search" && query.length > 0 && !usageError, staleTime: 5 * 60_000, retry: false }
  );
  const adopted = trpc.stockFootage.listAdoptions.useQuery(
    { purpose: props.purpose, ...(props.context?.projectId ? { projectId: props.context.projectId } : {}), limit: 60 },
    { enabled: tab === "adopted" }
  );
  const adopt = trpc.stockFootage.adopt.useMutation();

  const myPending = pending.filter(p => p.purpose === props.purpose);

  // 本机待办必须同步落盘：采用成功后业务方常会立即关闭面板（卸载），
  // 若把写入放在 setState 更新函数里，卸载后更新被丢弃，已完成的采用会一直显示「待继续」。
  const updatePending = useCallback((fn: (list: PendingAdoption[]) => PendingAdoption[]) => {
    const next = fn(readPending());
    writePending(next);
    setPending(next);
  }, []);

  const runAdopt = useCallback(
    async (item: PendingAdoption) => {
      setBusyId(item.requestId);
      try {
        const res = await adopt.mutateAsync({
          requestId: item.requestId,
          provider: "pexels",
          providerAssetId: item.providerAssetId,
          kind: item.kind,
          purpose: item.purpose,
          usage: item.usage,
          ...(item.orientation ? { orientation: item.orientation } : {}),
          context: item.context,
        });
        if (res.status === "succeeded" && res.asset) {
          updatePending(list => list.filter(p => p.requestId !== item.requestId));
          void utils.stockFootage.listAdoptions.invalidate();
          toast.success("素材已采用");
          props.onAdopted(res.asset);
        } else if (res.status === "failed") {
          updatePending(list => list.filter(p => p.requestId !== item.requestId));
          toast.error(res.message || "素材未能采用");
        } else {
          toast.message(res.message || "素材还在处理，可稍后点「继续」");
        }
      } catch (error) {
        // 网络中断：保留待办，同一编号可继续；参数冲突/未启用等明确错误才移除。
        const message = (error as { message?: string })?.message || "素材服务暂不可用";
        const code = (error as { data?: { code?: string } })?.data?.code;
        if (code === "CONFLICT" || code === "BAD_REQUEST") updatePending(list => list.filter(p => p.requestId !== item.requestId));
        toast.error(message);
      } finally {
        setBusyId(null);
      }
    },
    [adopt, props, updatePending, utils]
  );

  const onAdoptCandidate = (c: StockFootageCandidate) => {
    const item: PendingAdoption = {
      requestId: newRequestId(),
      providerAssetId: c.providerAssetId,
      kind: c.kind,
      purpose: props.purpose,
      usage,
      orientation,
      context: props.context ?? {},
      previewImageUrl: c.previewImageUrl,
      startedAt: Date.now(),
    };
    // 先落本机待办再发请求：请求回包丢失也能用原编号续做，不会重复入库。
    updatePending(list => [...list, item]);
    void runAdopt(item);
  };

  // 刷新后查询未完成待办在服务端的真实状态（只查询，不自动绑定到当前编辑位置）。
  const [pendingStatus, setPendingStatus] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const p of myPending) {
        // 刚发起的采用由 runAdopt 自己收尾；此时查询会与占位抢跑，得到「没有找到」的误报。
        if (Date.now() - p.startedAt < 2 * 60_000) continue;
        try {
          const res = await utils.stockFootage.getAdoption.fetch({ requestId: p.requestId });
          if (!cancelled) setPendingStatus(s => ({ ...s, [p.requestId]: res.status }));
        } catch {
          if (!cancelled) setPendingStatus(s => ({ ...s, [p.requestId]: "unknown" }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // 仅在挂载与待办数量变化时核对
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPending.length]);

  if (usageError) return <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">{usageError}</div>;

  const errorMessage = (search.error as { message?: string } | null)?.message;

  return (
    <div className={`flex flex-col gap-3 text-sm ${props.className ?? ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">
          图库素材 · {STOCK_FOOTAGE_PURPOSE_LABEL[props.purpose]}
          {usage === "reference" && <span className="ml-2 rounded bg-sky-500/20 px-1.5 py-0.5 text-xs text-sky-200">仅参考，不入片</span>}
          {usage === "empty_shot" && <span className="ml-2 rounded bg-violet-500/20 px-1.5 py-0.5 text-xs text-violet-200">空镜·无人物</span>}
        </div>
        <div className="flex gap-1">
          <button type="button" className={`rounded px-2 py-1 ${tab === "search" ? "bg-white/15" : "opacity-70"}`} onClick={() => setTab("search")}>搜索</button>
          <button type="button" className={`rounded px-2 py-1 ${tab === "adopted" ? "bg-white/15" : "opacity-70"}`} onClick={() => setTab("adopted")}>已采用</button>
        </div>
      </div>

      {myPending.length > 0 && (
        <div className="rounded-md border border-white/10 p-2">
          <div className="mb-1 text-xs opacity-70">未完成的采用（可继续，不会重复保存）</div>
          <div className="flex flex-wrap gap-2">
            {myPending.map(p => (
              <div key={p.requestId} className="flex items-center gap-2 rounded bg-white/5 px-2 py-1">
                {p.previewImageUrl && <img src={p.previewImageUrl} alt="" className="h-8 w-12 rounded object-cover" />}
                <span className="text-xs opacity-80">{pendingStatus[p.requestId] === "succeeded" ? "已完成" : pendingStatus[p.requestId] === "running" ? "处理中" : "待继续"}</span>
                <button type="button" disabled={busyId === p.requestId} className="flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-xs" onClick={() => void runAdopt(p)}>
                  {busyId === p.requestId ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
                  {pendingStatus[p.requestId] === "succeeded" ? "使用" : "继续"}
                </button>
                <button type="button" className="text-xs opacity-60" onClick={() => updatePending(list => list.filter(x => x.requestId !== p.requestId))}>移除</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "search" ? (
        <>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={e => {
              e.preventDefault();
              setPage(1);
              setQuery(draftQuery.trim());
            }}
          >
            <input
              value={draftQuery}
              onChange={e => setDraftQuery(e.target.value)}
              maxLength={100}
              placeholder="关键词（建议英文，如 city night rain）"
              className="min-w-[12rem] flex-1 rounded border border-white/15 bg-black/30 px-2 py-1.5"
            />
            <select value={kind} onChange={e => { setKind(e.target.value as StockFootageKind); setPage(1); }} className="rounded border border-white/15 bg-black/30 px-2 py-1.5">
              <option value="video">视频</option>
              <option value="photo">照片</option>
            </select>
            <select value={orientation ?? ""} onChange={e => { setOrientation((e.target.value || undefined) as StockFootageOrientation | undefined); setPage(1); }} className="rounded border border-white/15 bg-black/30 px-2 py-1.5">
              <option value="">不限画幅</option>
              <option value="landscape">横屏</option>
              <option value="portrait">竖屏</option>
              <option value="square">方形</option>
            </select>
            <button type="submit" className="flex items-center gap-1 rounded bg-white/15 px-3 py-1.5"><Search className="h-4 w-4" />搜索</button>
          </form>

          {search.isFetching && <div className="flex items-center gap-2 opacity-70"><Loader2 className="h-4 w-4 animate-spin" />搜索中…</div>}
          {errorMessage && <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-red-200">{errorMessage}</div>}
          {search.data && search.data.candidates.length === 0 && <div className="opacity-70">没有找到符合条件的素材，换个关键词或放宽画幅/时长试试。</div>}

          <div className={`grid gap-2 ${props.compact ? "grid-cols-3" : "grid-cols-2 md:grid-cols-3 lg:grid-cols-4"}`}>
            {search.data?.candidates.map(c => (
              <CandidateCard key={`${c.kind}-${c.providerAssetId}`} candidate={c} busy={adopt.isPending} onAdopt={() => onAdoptCandidate(c)} />
            ))}
          </div>

          {search.data && (search.data.hasMore || page > 1) && (
            <div className="flex items-center justify-center gap-3">
              <button type="button" disabled={page <= 1} className="rounded bg-white/10 px-2 py-1 disabled:opacity-40" onClick={() => setPage(p => p - 1)}>上一页</button>
              <span className="opacity-70">第 {page} 页</span>
              <button type="button" disabled={!search.data.hasMore} className="rounded bg-white/10 px-2 py-1 disabled:opacity-40" onClick={() => setPage(p => p + 1)}>下一页</button>
            </div>
          )}
        </>
      ) : (
        <div className={`grid gap-2 ${props.compact ? "grid-cols-3" : "grid-cols-2 md:grid-cols-3 lg:grid-cols-4"}`}>
          {adopted.isLoading && <div className="col-span-full flex items-center gap-2 opacity-70"><Loader2 className="h-4 w-4 animate-spin" />读取中…</div>}
          {adopted.data?.length === 0 && <div className="col-span-full opacity-70">还没有为此处采用过素材。</div>}
          {adopted.data?.map(a => (
            <div key={a.assetId} className="overflow-hidden rounded border border-white/10">
              {a.kind === "video" ? <video src={a.url} muted playsInline preload="metadata" className="aspect-video w-full object-cover" /> : <img src={a.url} alt="" className="aspect-video w-full object-cover" />}
              <div className="flex items-center justify-between gap-1 p-1.5 text-xs">
                <span className="truncate opacity-70">{a.kind === "video" ? "视频" : "照片"}{a.durationSec ? ` · ${fmtDuration(a.durationSec)}` : ""}</span>
                <button type="button" className="flex shrink-0 items-center gap-1 rounded bg-white/15 px-2 py-0.5" onClick={() => props.onAdopted(a)} disabled={a.usage !== usage}>
                  <Check className="h-3 w-3" />使用
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateCard({ candidate: c, busy, onAdopt }: { candidate: StockFootageCandidate; busy: boolean; onAdopt: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div className="overflow-hidden rounded border border-white/10" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="relative aspect-video bg-black/40">
        {hover && c.previewVideoUrl ? (
          <video src={c.previewVideoUrl} autoPlay muted loop playsInline className="h-full w-full object-cover" />
        ) : (
          <img src={c.previewImageUrl} alt={c.alt ?? ""} loading="lazy" className="h-full w-full object-cover" />
        )}
        <span className="absolute left-1 top-1 flex items-center gap-1 rounded bg-black/60 px-1 text-[10px]">
          {c.kind === "video" ? <Film className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
          {c.width}×{c.height}{c.durationSec ? ` · ${fmtDuration(c.durationSec)}` : ""}
        </span>
      </div>
      <div className="flex items-center justify-between gap-1 p-1.5 text-xs">
        <span className="truncate opacity-70">{c.kind === "video" ? "视频" : "照片"}</span>
        <button type="button" disabled={busy} onClick={onAdopt} className="shrink-0 rounded bg-white/15 px-2 py-0.5 disabled:opacity-40">采用</button>
      </div>
    </div>
  );
}

export default StockFootagePanel;
