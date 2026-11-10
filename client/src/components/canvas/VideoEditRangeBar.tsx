import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";

export type VideoEditRangeBarProps = {
  /** 片长（秒，一位小数）。 */
  durationSec: number;
  startSec: number;
  endSec: number;
  /** 不足最短时长时服务端将扩展到的区间（画成虚线带）；够长为 null。 */
  expandedTo?: { startSec: number; endSec: number } | null;
  /** 预览当前播放位置（秒）；不传不画播放线。 */
  playheadSec?: number | null;
  disabled?: boolean;
  /** 值已按「起点不越过终点」夹好再回调。 */
  onStartChange: (sec: number) => void;
  onEndChange: (sec: number) => void;
  /** 指针按住拖动的开始/结束（宿主据此等松手后再向服务端确认报价）。 */
  onDraggingChange?: (dragging: boolean) => void;
};

const STEP = 0.1;
const tenth = (n: number) => Math.round(n * 10) / 10;
/** 滑块半径（px）：轨道两端各让出半个滑块，叠在上面的选区/扩展带才能和滑块中心对齐。 */
const THUMB_HALF_PX = 10;

const thumbCls =
  "pointer-events-none absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none bg-transparent outline-none " +
  "[&::-webkit-slider-runnable-track]:h-full [&::-webkit-slider-runnable-track]:bg-transparent " +
  "[&::-moz-range-track]:h-full [&::-moz-range-track]:bg-transparent " +
  "[&::-webkit-slider-thumb]:mt-[10px] [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full " +
  "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-cyan-300 [&::-webkit-slider-thumb]:bg-slate-950 " +
  "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-cyan-300 [&::-moz-range-thumb]:bg-slate-950 " +
  "focus-visible:[&::-webkit-slider-thumb]:bg-cyan-300 focus-visible:[&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(103,232,249,0.35)] " +
  "focus-visible:[&::-moz-range-thumb]:bg-cyan-300 focus-visible:[&::-moz-range-thumb]:shadow-[0_0_0_4px_rgba(103,232,249,0.35)] " +
  "disabled:opacity-50";

/**
 * 双滑块区间条：一条轨道上两个滑块（起点 / 终点），起点不能越过终点。
 * 键盘：两个原生 range 输入各自可聚焦，方向键每次 0.1 秒（PageUp/PageDown、Home/End 走浏览器原生行为）。
 * 指针：按下时选离得最近的滑块并跟手拖动（点轨道任意处也行），不依赖两个原生滑块叠放时谁在上面。
 */
export function VideoEditRangeBar(props: VideoEditRangeBarProps) {
  const { durationSec, startSec, endSec, expandedTo, playheadSec, disabled } = props;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLInputElement | null>(null);
  const drag = useRef<"start" | "end" | null>(null);
  const live = useRef(props);
  live.current = props;

  const pct = (sec: number) => (durationSec > 0 ? Math.min(100, Math.max(0, (sec / durationSec) * 100)) : 0);
  const commitStart = (v: number) => {
    const p = live.current;
    if (!Number.isFinite(v)) return;
    p.onStartChange(tenth(Math.min(Math.max(0, v), Math.max(0, p.endSec - STEP))));
  };
  const commitEnd = (v: number) => {
    const p = live.current;
    if (!Number.isFinite(v)) return;
    p.onEndChange(tenth(Math.max(Math.min(p.durationSec, v), Math.min(p.durationSec, p.startSec + STEP))));
  };

  const secAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    return tenth(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * live.current.durationSec);
  };
  const stopDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    live.current.onDraggingChange?.(false);
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || e.button > 0) return;
    const sec = secAt(e.clientX);
    if (sec == null) return;
    const which = sec <= startSec ? "start" : sec >= endSec ? "end" : sec - startSec <= endSec - sec ? "start" : "end";
    drag.current = which;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 合成事件等拿不到捕获时照常按 move/up 处理
    }
    (which === "start" ? startRef : endRef).current?.focus();
    props.onDraggingChange?.(true);
    (which === "start" ? commitStart : commitEnd)(sec);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const sec = secAt(e.clientX);
    if (sec != null) (drag.current === "start" ? commitStart : commitEnd)(sec);
  };

  const selLeft = pct(Math.min(startSec, endSec));
  const selWidth = Math.max(0, pct(Math.max(startSec, endSec)) - selLeft);
  return (
    <div className="space-y-0.5" data-video-edit-range-bar>
      <div
        className={cn("relative h-10 touch-none select-none", disabled ? "cursor-not-allowed" : "cursor-pointer")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onLostPointerCapture={stopDrag}
      >
        <div ref={trackRef} data-range-track className="absolute inset-y-0" style={{ left: THUMB_HALF_PX, right: THUMB_HALF_PX }}>
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/12" />
          {expandedTo && (
            <div
              aria-hidden="true"
              data-range-expanded
              data-start={expandedTo.startSec.toFixed(1)}
              data-end={expandedTo.endSec.toFixed(1)}
              className="absolute top-1/2 h-5 -translate-y-1/2 rounded-md border border-dashed border-amber-300/80 bg-amber-300/10"
              style={{ left: `${pct(expandedTo.startSec)}%`, width: `${Math.max(0, pct(expandedTo.endSec) - pct(expandedTo.startSec))}%` }}
            />
          )}
          <div
            aria-hidden="true"
            data-range-selected
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-cyan-300"
            style={{ left: `${selLeft}%`, width: `${selWidth}%` }}
          />
          {playheadSec != null && Number.isFinite(playheadSec) && (
            <div
              aria-hidden="true"
              data-range-playhead
              className="absolute top-1/2 h-6 w-px -translate-x-1/2 -translate-y-1/2 bg-white/80"
              style={{ left: `${pct(playheadSec)}%` }}
            />
          )}
        </div>
        <input
          ref={startRef}
          aria-label="起点滑杆"
          aria-valuetext={`起点 ${startSec.toFixed(1)} 秒`}
          type="range"
          min={0}
          max={durationSec}
          step={STEP}
          value={startSec}
          disabled={disabled}
          onChange={e => commitStart(Number(e.target.value))}
          className={thumbCls}
        />
        <input
          ref={endRef}
          aria-label="终点滑杆"
          aria-valuetext={`终点 ${endSec.toFixed(1)} 秒`}
          type="range"
          min={0}
          max={durationSec}
          step={STEP}
          value={endSec}
          disabled={disabled}
          onChange={e => commitEnd(Number(e.target.value))}
          className={thumbCls}
        />
      </div>
      <div aria-hidden="true" className="flex justify-between px-[10px] text-[11px] tabular-nums text-white/45">
        <span>0.0</span>
        <span>{durationSec.toFixed(1)} 秒</span>
      </div>
    </div>
  );
}
