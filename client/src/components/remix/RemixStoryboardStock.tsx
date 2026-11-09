/**
 * 爆款复刻 · 视频分镜 + 「找素材」（共用图库抽屉的第五个接入端）。
 *
 * 目的：整支照搬原片会被平台查重判成搬运，所以每一段都可以从图库找实拍替换原片画面。
 * 范围：找素材 → 服务端存进本人空间（purpose=remix, usage=insert）→ 这里按用户 id 记在本机、显示缩略图/预览/移除；
 * 用户自己剪，不接成片 / 导出。预览地址由 listAdoptions 每次重新签，本机只存 assetId 等稳定字段。
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Film, Trash2, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { StockFootageDrawer, type StockFootagePick } from "@/components/stockFootage/StockFootageDrawer";
import {
  addRemixStockPick,
  parseSegmentDurationSec,
  readRemixStockPicks,
  remixPickFromAsset,
  remixPickSeconds,
  remixSegmentSeconds,
  removeRemixStockPick,
  writeRemixStockPicks,
  type RemixStockPicksBySegment,
} from "@/lib/remixStockPicks";

export type RemixStoryboardSegment = { time: string; title: string; detail: string };

export const REMIX_STOCK_GUIDE = "结构学爆款，画面用自己的：每段都可从图库找实拍替换，至少换 1–2 段，避免与原片画面指纹重合被判搬运。";

const fmtSec = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function RemixStoryboardStock({ userId, segments, analyzed }: { userId: number; segments: RemixStoryboardSegment[]; analyzed: boolean }) {
  // 页面用 key={userId} 挂载本组件：换账号即重挂，首帧就读到本人的记录（无闪烁、无空状态误写）
  const [picks, setPicks] = useState<RemixStockPicksBySegment>(() => (typeof localStorage === "undefined" ? {} : readRemixStockPicks(localStorage, userId)));
  const [drawerSegmentId, setDrawerSegmentId] = useState<string | null>(null);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  /** 刚采用时抽屉返回的签名地址：listAdoptions 刷新前先用它显示。 */
  const [freshUrls, setFreshUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!writeRemixStockPicks(localStorage, userId, picks)) toast.error("本机保存失败，刷新后可能丢失已采用素材的记录");
  }, [picks, userId]);

  const pickedCount = Object.values(picks).reduce((n, list) => n + list.length, 0);
  const adoptions = trpc.stockFootage.listAdoptions.useQuery({ purpose: "remix", limit: 100 }, { enabled: pickedCount > 0, retry: false, staleTime: 5 * 60_000 });
  const urlByAssetId = useMemo(() => {
    const map: Record<string, string> = { ...freshUrls };
    for (const asset of adoptions.data ?? []) map[asset.assetId] = asset.url;
    return map;
  }, [adoptions.data, freshUrls]);

  const drawerIndex = drawerSegmentId ? segments.findIndex((_, i) => String(i + 1) === drawerSegmentId) : -1;
  const drawerSegment = drawerIndex >= 0 ? segments[drawerIndex] : undefined;

  const adopt = (segmentId: string, pick: StockFootagePick) => {
    if (pick.asset.purpose !== "remix" || pick.asset.usage !== "insert") throw new Error("该素材不是为复刻替换画面采用的，请重新采用");
    if (pick.asset.kind !== "video") throw new Error("复刻替换画面需要视频素材");
    const record = remixPickFromAsset(pick.asset, { inSec: pick.inSec, outSec: pick.outSec });
    setFreshUrls(prev => ({ ...prev, [record.assetId]: pick.asset.url }));
    setPicks(prev => addRemixStockPick(prev, segmentId, record));
    setDrawerSegmentId(null);
    toast.success(`「${segments[Number(segmentId) - 1]?.title ?? `第 ${segmentId} 段`}」已采用素材，取 ${fmtSec(record.inSec)}–${fmtSec(record.outSec)} 秒；素材已存入你的空间`);
    void adoptions.refetch();
  };

  const replacedSegments = segments.filter((_, i) => (picks[String(i + 1)]?.length ?? 0) > 0).length;
  const previewUrl = previewAssetId ? urlByAssetId[previewAssetId] : undefined;

  return (
    <section className="mt-8 rounded-[28px] border border-[#8af0ff]/25 bg-[#0f1a2c] p-6" aria-label="视频分镜与找素材">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-[#8af0ff]">
          <Film className="h-5 w-5" />
          <h2 className="text-2xl font-bold">视频分镜 · 找素材替换画面</h2>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${replacedSegments >= 1 ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300" : "border-white/15 bg-white/5 text-white/60"}`}>
          已替换 {replacedSegments} / {segments.length} 段
        </span>
      </div>
      <p className="mt-3 text-sm leading-7 text-white/70">{REMIX_STOCK_GUIDE}</p>
      {!analyzed && <p className="mt-1 text-xs text-white/45">还没分析参考视频：下面是通用四段结构，分析后各段说明会按参考视频更新；已采用的素材记录在本机，刷新后仍在。</p>}
      <p className="mt-1 text-xs text-white/45">采用的素材会存进你的空间，下载后在剪辑软件里替换对应段落；本页不生成成片。</p>

      <div className="mt-5 grid gap-4">
        {segments.map((segment, index) => {
          const segmentId = String(index + 1);
          const list = picks[segmentId] ?? [];
          const replaced = list.length > 0;
          return (
            <div key={segmentId} className="rounded-2xl border border-white/10 bg-black/20 p-5" data-testid={`remix-segment-${segmentId}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[#8af0ff]/20 bg-[#8af0ff]/10 px-2 py-1 text-[11px] font-semibold text-[#8af0ff]">{segment.time}</span>
                <span className="text-base font-bold text-white">{segment.title}</span>
                <span className={`text-xs ${replaced ? "text-emerald-300" : "text-white/45"}`}>{replaced ? "已替换" : "原片画面"}</span>
                <button type="button" onClick={() => setDrawerSegmentId(segmentId)}
                  className="ml-auto rounded-xl border border-[#8af0ff]/30 bg-[#8af0ff]/10 px-3 py-1.5 text-xs font-semibold text-[#8af0ff] transition hover:bg-[#8af0ff]/20">
                  找素材
                </button>
              </div>
              <p className="mt-3 text-sm leading-7 text-white/75">{segment.detail}</p>
              {replaced && (
                <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-3">
                  <div className="text-xs font-semibold text-emerald-300">已采用素材 · {fmtSec(remixSegmentSeconds(list))} 秒</div>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {list.map(pick => {
                      const url = urlByAssetId[pick.assetId];
                      return (
                        <div key={pick.assetId} className="w-[132px] overflow-hidden rounded-lg border border-white/10 bg-black/40">
                          <button type="button" className="block h-[176px] w-full bg-black" disabled={!url} onClick={() => setPreviewAssetId(pick.assetId)} aria-label="预览素材">
                            {url ? <video src={url} className="h-full w-full object-cover" muted playsInline preload="metadata" /> : <span className="flex h-full items-center justify-center text-[11px] text-white/40">{adoptions.isLoading ? "读取中…" : "暂无预览"}</span>}
                          </button>
                          <div className="flex items-center justify-between gap-1 px-2 py-1.5 text-[11px] text-white/70">
                            <span>{fmtSec(remixPickSeconds(pick))} 秒 · {pick.width}×{pick.height}</span>
                            <button type="button" aria-label="移除该素材" className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-red-300"
                              onClick={() => { setPicks(prev => removeRemixStockPick(prev, segmentId, pick.assetId)); if (previewAssetId === pick.assetId) setPreviewAssetId(null); }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {adoptions.isError && <div className="mt-2 text-[11px] text-amber-300">预览地址读取失败，稍后刷新重试；已采用的素材仍在你的空间里。</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {previewAssetId && previewUrl && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-label="素材预览" onClick={() => setPreviewAssetId(null)}>
          <div className="relative max-h-full" onClick={event => event.stopPropagation()}>
            <button type="button" aria-label="关闭预览" className="absolute -right-3 -top-3 rounded-full bg-white/15 p-1.5 text-white hover:bg-white/30" onClick={() => setPreviewAssetId(null)}>
              <X className="h-4 w-4" />
            </button>
            <video src={previewUrl} className="max-h-[80vh] rounded-xl" controls autoPlay playsInline />
          </div>
        </div>
      )}

      {drawerSegment && (
        <StockFootageDrawer key={drawerSegmentId!} open onClose={() => setDrawerSegmentId(null)}
          title={`为「${drawerSegment.title}」找素材`} purpose="remix" usage="insert" kind="video" orientation="portrait"
          targetDurationSec={parseSegmentDurationSec(drawerSegment.time)} sourceText={drawerSegment.detail}
          context={{ note: drawerSegment.title, segmentId: drawerSegmentId! }}
          onPick={pick => adopt(drawerSegmentId!, pick)} />
      )}
    </section>
  );
}
