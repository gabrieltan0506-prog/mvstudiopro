/**
 * 营销口播「画面 / 旁白」双轨时间线：按段落时长（有效配音按实测，否则按预估）横向排布。
 * 画面轨：缩略图或「待配画面」占位，点击打开本段找素材抽屉；旁白轨：每段配音状态。
 */
import {
  marketingTimelineSec,
  marketingVoiceTrackState,
  type MarketingSegment,
  type MarketingVoiceTrackState,
} from "@shared/marketingProduction";

const VOICE_TONE: Record<MarketingVoiceTrackState["tone"], string> = {
  ready: "border-emerald-300/60 bg-emerald-400/20 text-emerald-100",
  pending: "border-sky-300/50 bg-sky-400/15 text-sky-100",
  stale: "border-amber-300/60 bg-amber-400/15 text-amber-100",
  failed: "border-rose-300/60 bg-rose-400/15 text-rose-100",
  empty: "border-dashed border-white/25 bg-black/20 text-slate-400",
};

export function MarketingThumb(props: { url?: string; startSec?: number; label?: string; className?: string }) {
  if (!props.url) return <div className={`flex items-center justify-center border border-dashed border-amber-300/50 bg-black/30 text-[11px] text-amber-200 ${props.className || ""}`}>{props.label || "待配画面"}</div>;
  // 只取首帧做缩略：预载元数据、静音、不自动播放；签名地址只在本次会话使用，不入稿
  return <video className={`bg-black object-cover ${props.className || ""}`} src={`${props.url}#t=${(props.startSec || 0).toFixed(2)}`} muted playsInline preload="metadata" />;
}

export function MarketingSegmentTimeline(props: {
  segments: MarketingSegment[];
  thumbFor: (segment: MarketingSegment) => { url?: string; startSec?: number; label?: string };
  onOpenSegment: (segmentId: string) => void;
  disabled?: boolean;
}) {
  const durations = props.segments.map(marketingTimelineSec);
  const total = durations.reduce((sum, sec) => sum + sec, 0);
  if (!props.segments.length || total <= 0) return null;
  let offset = 0;
  const starts = durations.map(sec => { const start = offset; offset += sec; return start; });
  return <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3" aria-label="画面与旁白时间线">
    <div className="flex items-center justify-between text-xs text-slate-400">
      <span className="font-semibold text-slate-200">时间线</span>
      <span>共约 {total.toFixed(1)} 秒</span>
    </div>
    <div className="mt-2 grid grid-cols-[3rem_1fr] items-stretch gap-x-2 gap-y-1 text-[11px]">
      <span className="self-center text-slate-400">画面</span>
      <div className="flex gap-1 overflow-hidden">
        {props.segments.map((segment, i) => {
          const thumb = props.thumbFor(segment);
          return <button key={segment.segmentId} type="button" disabled={props.disabled}
            title={`第 ${i + 1} 段 · 约 ${durations[i].toFixed(1)} 秒（点击找素材）`}
            aria-label={`第 ${i + 1} 段画面，点击找素材`}
            style={{ flexGrow: durations[i], flexBasis: 0 }}
            className="relative h-14 min-w-[2.5rem] overflow-hidden rounded-md disabled:opacity-60"
            onClick={() => props.onOpenSegment(segment.segmentId)}>
            <MarketingThumb url={thumb.url} startSec={thumb.startSec} label={thumb.url ? undefined : thumb.label || "待配画面"} className="h-full w-full rounded-md" />
            <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{String(i + 1).padStart(2, "0")}</span>
          </button>;
        })}
      </div>
      <span className="self-center text-slate-400">旁白</span>
      <div className="flex gap-1 overflow-hidden">
        {props.segments.map((segment, i) => {
          const state = marketingVoiceTrackState(segment);
          return <div key={segment.segmentId} style={{ flexGrow: durations[i], flexBasis: 0 }}
            className={`min-w-[2.5rem] truncate rounded-md border px-1 py-1 ${VOICE_TONE[state.tone]}`} title={`第 ${i + 1} 段：${state.label}`}>
            {state.label}
          </div>;
        })}
      </div>
      <span />
      <div className="flex gap-1 text-[10px] text-slate-500">
        {props.segments.map((segment, i) => <span key={segment.segmentId} style={{ flexGrow: durations[i], flexBasis: 0 }} className="min-w-[2.5rem] truncate">{starts[i].toFixed(1)}s</span>)}
      </div>
    </div>
  </div>;
}
