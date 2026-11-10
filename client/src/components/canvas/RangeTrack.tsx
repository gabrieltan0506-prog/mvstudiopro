import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  clampNumber, clampSegmentBoundary, formatTrackSeconds, keyboardTarget, moveRangeThumb, ratioToSec, secToRatio,
  segmentBoundaryLimits, snapWithin, type RangeTrackMarker, type RangeTrackSegment, type RangeTrackTone,
} from "@/lib/rangeTrack";

export type { RangeTrackMarker, RangeTrackSegment, RangeTrackTone };

type CommonProps = {
  /** 吸附步长（秒），缺省 0.1。 */
  step?: number;
  disabled?: boolean;
  /** 播放位置指示线。 */
  cursorSec?: number;
  /** 点击轨道或拖动滑块/边界时回报秒位，用于预览跳转。 */
  onSeek?: (sec: number) => void;
  /** 切点 / 接点标记。 */
  markers?: RangeTrackMarker[];
  formatValue?: (sec: number) => string;
  className?: string;
};

export type RangeTrackRangeProps = CommonProps & {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  /** 半透明画出「将扩展到的区间」。 */
  ghost?: [number, number];
  /** 起止之间至少保留的秒数，缺省 0（可重合但不可越过）。 */
  minGap?: number;
  ariaLabelStart?: string;
  ariaLabelEnd?: string;
  segments?: undefined;
};

export type RangeTrackSegmentsProps = CommonProps & {
  /** 首尾相接的分段；轨道范围取首段起点到末段终点。 */
  segments: RangeTrackSegment[];
  /** 拖动第 index 与 index+1 段之间的边界；调用方同时更新两段即可保持首尾相接。 */
  onBoundaryChange?: (index: number, sec: number) => void;
  /** 每段至少保留的秒数，缺省等于 step。 */
  minSegmentSec?: number;
  /** 边界滑块的无障碍名称，缺省「第 N 与 N+1 段的分界」。 */
  boundaryAriaLabel?: (index: number) => string;
  /** 点选某一段（例如切换正在调整的段）。 */
  onSegmentSelect?: (index: number) => void;
  selectedIndex?: number;
};

export type RangeTrackProps = RangeTrackRangeProps | RangeTrackSegmentsProps;

const TONE_FILL: Record<RangeTrackTone | "none", string> = {
  none: "border-white/15 bg-white/10 text-white/75",
  ok: "border-emerald-300/35 bg-emerald-500/15 text-emerald-50",
  warn: "border-amber-300/40 bg-amber-500/15 text-amber-100",
  bad: "border-red-300/40 bg-red-500/15 text-red-100",
};
const TONE_MARK: Record<RangeTrackTone | "none", string> = { none: "bg-white/70", ok: "bg-emerald-300", warn: "bg-amber-300", bad: "bg-red-300" };
const TONE_TEXT: Record<RangeTrackTone | "none", string> = { none: "text-white/60", ok: "text-emerald-200", warn: "text-amber-200", bad: "text-red-200" };
const HANDLE = "group absolute top-0 z-20 flex h-full w-6 -translate-x-1/2 touch-none select-none items-center justify-center outline-none disabled:cursor-not-allowed";
const HANDLE_BAR = "h-full w-1 rounded-full bg-white shadow group-hover:bg-emerald-200 group-focus-visible:w-1.5 group-focus-visible:bg-emerald-200 group-focus-visible:ring-2 group-focus-visible:ring-emerald-300/70";

const pct = (ratio: number) => `${(ratio * 100).toFixed(4)}%`;

export function RangeTrack(props: RangeTrackProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<number | null>(null);
  const step = props.step && props.step > 0 ? props.step : 0.1;
  const disabled = Boolean(props.disabled);
  const format = props.formatValue ?? formatTrackSeconds;
  const segments = props.segments;
  const min = segments ? segments[0]?.startSec ?? 0 : props.min;
  const max = segments ? segments[segments.length - 1]?.endSec ?? 0 : props.max;
  const ratio = (sec: number) => secToRatio(sec, min, max);

  const secAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return min;
    return ratioToSec((clientX - rect.left) / rect.width, min, max);
  };

  /** 把第 index 个把手移到 raw 秒位；返回实际落点（未变化返回 null）。 */
  const moveHandle = (index: number, raw: number): number | null => {
    if (disabled) return null;
    if (segments) {
      const minLen = props.minSegmentSec ?? step;
      const next = clampSegmentBoundary(segments, index, raw, { step, minLen, origin: min });
      if (next == null) return null;
      if (next !== segments[index]!.endSec) props.onBoundaryChange?.(index, next);
      return next;
    }
    const thumb = index === 0 ? 0 : 1;
    const next = moveRangeThumb(props.value, thumb, raw, { min, max, step, minGap: props.minGap });
    if (next[0] !== props.value[0] || next[1] !== props.value[1]) props.onChange(next);
    return next[thumb];
  };

  const handleProps = (index: number, now: number, lo: number, hi: number, label: string) => ({
    type: "button" as const,
    role: "slider",
    "aria-label": label,
    "aria-orientation": "horizontal" as const,
    "aria-valuemin": lo,
    "aria-valuemax": hi,
    "aria-valuenow": now,
    "aria-valuetext": format(now),
    "aria-disabled": disabled || undefined,
    disabled,
    "data-range-track-handle": index,
    className: `${HANDLE} ${disabled ? "opacity-45" : "cursor-ew-resize"}`,
    style: { left: pct(ratio(now)) },
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.stopPropagation();
      dragging.current = index;
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 合成事件无指针可捕获 */ }
      event.currentTarget.focus();
    },
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (dragging.current !== index) return;
      const landed = moveHandle(index, secAt(event.clientX));
      if (landed != null) props.onSeek?.(landed);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
      dragging.current = null;
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 已释放 */ }
    },
    onPointerCancel: () => { dragging.current = null; },
    onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      const target = keyboardTarget(now, event.key, event.shiftKey, step, lo, hi);
      if (target == null) return;
      event.preventDefault();
      // Home/End 直达可达范围端点，不再吸附，避免端点不在步长格点上时到不了。
      const landed = event.key === "Home" || event.key === "End" ? moveHandle(index, target) : moveHandle(index, snapWithin(target, lo, hi, min, step));
      if (landed != null) props.onSeek?.(landed);
    },
  });

  const onTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !props.onSeek || (event.pointerType === "mouse" && event.button !== 0)) return;
    props.onSeek(snapWithin(secAt(event.clientX), min, max, min, step));
  };

  const markers = (props.markers ?? []).filter(marker => marker.sec >= min && marker.sec <= max);
  const cursor = typeof props.cursorSec === "number" && Number.isFinite(props.cursorSec) ? clampNumber(props.cursorSec, min, max) : null;

  return (
    <div className={`w-full min-w-0 select-none ${props.className ?? ""}`} data-range-track={segments ? "segments" : "range"}>
      <div
        ref={trackRef}
        className={`relative h-9 w-full touch-none rounded-lg border border-white/15 bg-black/30 ${disabled ? "opacity-60" : props.onSeek ? "cursor-pointer" : ""}`}
        onPointerDown={onTrackPointerDown}
      >
        {segments ? segments.map((segment, index) => {
          const left = ratio(segment.startSec); const width = Math.max(0, ratio(segment.endSec) - left);
          const selected = props.selectedIndex === index;
          return (
            <div
              key={index}
              data-range-track-segment={index}
              data-tone={segment.tone ?? "none"}
              title={`${segment.label ? `${segment.label} · ` : ""}${format(segment.startSec)} – ${format(segment.endSec)}`}
              className={`absolute inset-y-0 flex items-center overflow-hidden border-y px-1.5 text-[10px] font-semibold ${TONE_FILL[segment.tone ?? "none"]} ${index === 0 ? "rounded-l-lg border-l" : ""} ${index === segments.length - 1 ? "rounded-r-lg border-r" : ""} ${selected ? "ring-2 ring-inset ring-white/70" : ""}`}
              style={{ left: pct(left), width: pct(width) }}
              onClick={props.onSegmentSelect && !disabled ? () => props.onSegmentSelect?.(index) : undefined}
            >
              <span className="truncate">{segment.label ?? ""}</span>
            </div>
          );
        }) : (
          <>
            {props.ghost ? (
              <div
                data-range-track-ghost
                className="pointer-events-none absolute inset-y-0 rounded border border-dashed border-emerald-300/45 bg-emerald-500/10"
                style={{ left: pct(ratio(Math.min(...props.ghost))), width: pct(Math.max(0, ratio(Math.max(...props.ghost)) - ratio(Math.min(...props.ghost)))) }}
              />
            ) : null}
            <div
              data-range-track-selection
              className="pointer-events-none absolute inset-y-0 border-y border-emerald-300/35 bg-emerald-500/25"
              style={{ left: pct(ratio(props.value[0])), width: pct(Math.max(0, ratio(props.value[1]) - ratio(props.value[0]))) }}
            />
          </>
        )}

        {markers.map((marker, index) => (
          <div key={`m${index}`} data-range-track-marker={index} title={marker.label ? `${marker.label} · ${format(marker.sec)}` : format(marker.sec)} className="pointer-events-none absolute inset-y-0 z-10 flex -translate-x-1/2 flex-col items-center" style={{ left: pct(ratio(marker.sec)) }}>
            <span className={`h-full w-px ${TONE_MARK[marker.tone ?? "none"]}`} />
            <span className={`absolute -top-1 h-2 w-2 rotate-45 ${TONE_MARK[marker.tone ?? "none"]}`} />
          </div>
        ))}

        {cursor != null ? <div data-range-track-cursor className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-amber-200" style={{ left: pct(ratio(cursor)) }} /> : null}

        {segments
          ? segments.slice(0, -1).map((segment, index) => {
            const limits = segmentBoundaryLimits(segments, index, props.minSegmentSec ?? step)!;
            const label = props.boundaryAriaLabel?.(index) ?? `第 ${index + 1} 与 ${index + 2} 段的分界`;
            return <button key={`b${index}`} {...handleProps(index, segment.endSec, limits.lo, limits.hi, label)}><span className={HANDLE_BAR} /></button>;
          })
          : (
            <>
              <button {...handleProps(0, props.value[0], min, Math.max(min, props.value[1] - (props.minGap ?? 0)), props.ariaLabelStart ?? "区间起点")}><span className={HANDLE_BAR} /></button>
              <button {...handleProps(1, props.value[1], Math.min(max, props.value[0] + (props.minGap ?? 0)), max, props.ariaLabelEnd ?? "区间终点")}><span className={HANDLE_BAR} /></button>
            </>
          )}
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[10px] text-white/55">
        <span>{format(min)}</span>
        {segments ? null : <span className="text-white/75" data-range-track-readout>{format(props.value[0])} – {format(props.value[1])}</span>}
        {markers.filter(marker => marker.label).map((marker, index) => <span key={index} className={TONE_TEXT[marker.tone ?? "none"]}>{marker.label} {format(marker.sec)}</span>)}
        <span>{format(max)}</span>
      </div>
    </div>
  );
}

export default RangeTrack;
