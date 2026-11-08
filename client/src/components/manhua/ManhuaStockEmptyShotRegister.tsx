/**
 * 1108 漫剧 · 图库无人物空镜登记（多轨剪辑台「当前片段」处）。
 * 只按 purpose=manhua / usage=empty_shot 采用视频；裁点由共用抽屉拖柄给出（目标时长 = 段长），登记前仍须勾选「画面中没有人物」。
 * 登记由父组件走既有「登记已有成片」链落档（署名 + 空镜标记 + 裁点随草稿保存）。
 */
import { useState } from "react";
import { StockFootageDrawer, type StockFootagePick } from "@/components/stockFootage/StockFootageDrawer";
import type { StockFootageAssetView } from "@shared/stockFootage";
import { manhuaEmptyShotTrimFromPick, type ManhuaEmptyShotDraftTrim } from "@/lib/manhuaStockEmptyShotPick";

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
  /** 本段中文描述：抽屉据此生成可编辑关键词（initialQuery 有值时优先） */
  sourceText?: string;
  onRegister: (pick: ManhuaStockEmptyShotPick) => void | Promise<void>;
}) {
  const { segmentIndex, plannedDurationSec } = props;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [picked, setPicked] = useState<{ asset: StockFootageAssetView; trim: ManhuaEmptyShotDraftTrim } | null>(null);
  const [noPerson, setNoPerson] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 抽屉「采用并绑定」：裁点来自抽屉拖柄，这里只夹取并进入「无人物」确认步骤；还没登记进本段。
  const pick = (next: StockFootagePick) => {
    const trim = manhuaEmptyShotTrimFromPick(next, plannedDurationSec);
    setPicked({ asset: next.asset, trim });
    setNoPerson(false);
    setError("");
    setDrawerOpen(false);
  };

  const drawer = (
    <StockFootageDrawer
      open={drawerOpen}
      onClose={() => setDrawerOpen(false)}
      title={`为第 ${segmentIndex} 段找无人物空镜`}
      purpose="manhua"
      usage="empty_shot"
      kind="video"
      targetDurationSec={plannedDurationSec > 0 ? plannedDurationSec : undefined}
      initialQuery={props.initialQuery}
      sourceText={props.sourceText?.trim().slice(0, 1000) || undefined}
      context={{ projectId: props.projectId, segmentId: `segment-${segmentIndex}`, note: "漫剧无人物空镜" }}
      confirmLabel="采用这段空镜"
      onPick={pick}
    />
  );

  if (!picked) {
    return (
      <>
        <button
          type="button"
          data-manhua-edit-stock-empty-shot={segmentIndex}
          disabled={props.disabled}
          onClick={() => setDrawerOpen(true)}
          className="min-h-10 rounded-lg border border-emerald-300/35 px-3 py-2 text-xs text-emerald-100 disabled:opacity-40"
        >
          图库空镜·无人物
        </button>
        {drawer}
      </>
    );
  }

  const { asset, trim } = picked;
  return (
    <div data-manhua-stock-empty-shot-panel={segmentIndex} className="w-full space-y-2 rounded-xl border border-emerald-300/25 bg-emerald-500/[0.04] p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-emerald-100">第 {segmentIndex} 段 · 图库空镜（只收无人物画面，不能替代角色）</p>
        <button type="button" onClick={() => { setPicked(null); setError(""); }} className="rounded border border-white/15 px-2 py-1 text-[11px] text-white/60">收起</button>
      </div>
      <video key={`${asset.assetId}:${trim.inSec}:${trim.outSec}`} src={`${asset.url}#t=${trim.inSec},${trim.outSec}`} controls muted playsInline preload="metadata" className="max-h-48 w-full rounded-lg bg-black object-contain" aria-label="图库空镜预览" />
      <p className="text-[11px] text-white/55" data-manhua-stock-attribution>
        空镜·无人物 · 素材长 {trim.sourceDurationSec.toFixed(1)} 秒
      </p>
      <p data-manhua-stock-empty-shot-trim className={`text-[11px] ${trim.offPlan ? "text-amber-200" : "text-white/55"}`}>
        裁点 {trim.inSec.toFixed(1)}–{trim.outSec.toFixed(1)} 秒 · 裁后 {trim.spanSec.toFixed(1)} 秒 / 本段规划 {plannedDurationSec} 秒
        {trim.offPlan ? " · 与本段时长相差较多，请换一条重新取段" : ""}
      </p>
      <label className="flex items-center gap-2 text-[11px] text-white/80">
        <input type="checkbox" data-manhua-stock-no-person checked={noPerson} onChange={(e) => setNoPerson(e.target.checked)} />
        我已看过，画面中没有人物（空镜不能替代既定角色）
      </label>
      {error ? <p role="alert" className="text-[11px] text-rose-200">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          data-manhua-stock-empty-shot-confirm={segmentIndex}
          disabled={props.disabled || busy || !noPerson}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await props.onRegister({ asset, inSec: trim.inSec, outSec: trim.outSec, noPersonConfirmed: noPerson });
              setPicked(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-lg border border-emerald-300/40 px-3 py-1.5 text-xs text-emerald-100 disabled:opacity-40"
        >
          {busy ? "正在登记…" : `登记为第 ${segmentIndex} 段空镜`}
        </button>
        <button type="button" onClick={() => setDrawerOpen(true)} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60">换一条 / 重新取段</button>
      </div>
      {drawer}
    </div>
  );
}
