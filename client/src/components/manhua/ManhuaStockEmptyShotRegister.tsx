/**
 * 1108 漫剧 · 图库无人物空镜登记（多轨剪辑台「当前片段」处）。
 * 只按 purpose=manhua / usage=empty_shot 采用视频；登记前必须选裁点并勾选「画面中没有人物」。
 * 登记由父组件走既有「登记已有成片」链落档（署名 + 空镜标记 + 裁点随草稿保存）。
 */
import { useState } from "react";
import { StockFootagePanel } from "@/components/stockFootage/StockFootagePanel";
import type { StockFootageAssetView } from "@shared/stockFootage";
import { MANHUA_STOCK_EMPTY_SHOT_TOLERANCE_SEC, clampManhuaStockEmptyShotTrim } from "@shared/manhuaStockFootage";

export type ManhuaStockEmptyShotPick = {
  asset: StockFootageAssetView;
  inSec: number;
  outSec: number;
  noPersonConfirmed: boolean;
};

export function ManhuaStockEmptyShotRegister(props: {
  segmentIndex: number;
  plannedDurationSec: number;
  projectId?: string;
  disabled?: boolean;
  initialQuery?: string;
  onRegister: (pick: ManhuaStockEmptyShotPick) => void | Promise<void>;
}) {
  const { segmentIndex, plannedDurationSec } = props;
  const [open, setOpen] = useState(false);
  const [asset, setAsset] = useState<StockFootageAssetView | null>(null);
  const [inSec, setInSec] = useState(0);
  const [outSec, setOutSec] = useState(0);
  const [noPerson, setNoPerson] = useState(false);
  const [busy, setBusy] = useState(false);

  const adopt = (next: StockFootageAssetView) => {
    const dur = Number(next.durationSec) || 0;
    const trim = dur >= 0.5 ? clampManhuaStockEmptyShotTrim(dur, 0, Math.min(dur, plannedDurationSec || dur)) : { inSec: 0, outSec: 0 };
    setAsset(next);
    setInSec(trim.inSec);
    setOutSec(trim.outSec);
    setNoPerson(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        data-manhua-edit-stock-empty-shot={segmentIndex}
        disabled={props.disabled}
        onClick={() => setOpen(true)}
        className="min-h-10 rounded-lg border border-emerald-300/35 px-3 py-2 text-xs text-emerald-100 disabled:opacity-40"
      >
        图库空镜·无人物
      </button>
    );
  }

  const dur = Number(asset?.durationSec) || 0;
  const span = Math.max(0, outSec - inSec);
  const off = plannedDurationSec > 0 && Math.abs(span - plannedDurationSec) > MANHUA_STOCK_EMPTY_SHOT_TOLERANCE_SEC;
  return (
    <div data-manhua-stock-empty-shot-panel={segmentIndex} className="w-full space-y-2 rounded-xl border border-emerald-300/25 bg-emerald-500/[0.04] p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-emerald-100">第 {segmentIndex} 段 · 图库空镜（只收无人物画面，不能替代角色）</p>
        <button type="button" onClick={() => { setOpen(false); setAsset(null); }} className="rounded border border-white/15 px-2 py-1 text-[11px] text-white/60">收起</button>
      </div>
      {!asset ? (
        <StockFootagePanel
          purpose="manhua"
          usage="empty_shot"
          defaultKind="video"
          compact
          minDurationSec={Math.max(1, Math.floor(plannedDurationSec || 1))}
          initialQuery={props.initialQuery}
          context={{ projectId: props.projectId, segmentId: `segment-${segmentIndex}`, note: "漫剧无人物空镜" }}
          onAdopted={adopt}
        />
      ) : (
        <div className="space-y-2">
          <video src={asset.url} controls muted playsInline preload="metadata" className="max-h-48 w-full rounded-lg bg-black object-contain" aria-label="图库空镜预览" />
          <p className="text-[11px] text-white/55" data-manhua-stock-attribution>
            空镜·无人物 · 素材长 {dur.toFixed(1)} 秒
          </p>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/70">
            <label>入点(秒)<input type="number" min={0} max={dur} step={0.1} value={inSec} onChange={(e) => setInSec(Math.max(0, Number(e.target.value) || 0))} className="ml-1 w-20 rounded bg-black/40 px-1" /></label>
            <label>出点(秒)<input type="number" min={0} max={dur} step={0.1} value={outSec} onChange={(e) => setOutSec(Math.max(0, Number(e.target.value) || 0))} className="ml-1 w-20 rounded bg-black/40 px-1" /></label>
            <span className={off ? "text-amber-200" : "text-white/45"}>裁后 {span.toFixed(1)} 秒 / 本段规划 {plannedDurationSec} 秒</span>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-white/80">
            <input type="checkbox" data-manhua-stock-no-person checked={noPerson} onChange={(e) => setNoPerson(e.target.checked)} />
            我已看过，画面中没有人物（空镜不能替代既定角色）
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              data-manhua-stock-empty-shot-confirm={segmentIndex}
              disabled={props.disabled || busy || !noPerson}
              onClick={async () => {
                setBusy(true);
                try {
                  await props.onRegister({ asset, inSec, outSec, noPersonConfirmed: noPerson });
                  setOpen(false);
                  setAsset(null);
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-lg border border-emerald-300/40 px-3 py-1.5 text-xs text-emerald-100 disabled:opacity-40"
            >
              {busy ? "正在登记…" : `登记为第 ${segmentIndex} 段空镜`}
            </button>
            <button type="button" onClick={() => setAsset(null)} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60">换一条</button>
          </div>
        </div>
      )}
    </div>
  );
}
