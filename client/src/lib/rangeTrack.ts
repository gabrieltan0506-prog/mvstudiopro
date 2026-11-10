/** 时间轴区间条 / 分段条的纯计算：吸附、夹取、键盘步进、分段边界移动。无 DOM、无业务依赖。 */

export type RangeTrackTone = "ok" | "warn" | "bad";
export type RangeTrackSegment = { startSec: number; endSec: number; label?: string; tone?: RangeTrackTone };
export type RangeTrackMarker = { sec: number; label?: string; tone?: RangeTrackTone };

const EPS = 1e-9;

export function clampNumber(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  if (hi < lo) return lo;
  return Math.min(hi, Math.max(lo, value));
}

/** 以 min 为原点按 step 吸附，并消除浮点尾差（0.1+0.2 这类）。 */
export function snapToStep(value: number, min: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(value)) return value;
  const snapped = min + Math.round((value - min) / step + EPS) * step;
  const decimals = Math.min(6, Math.max(0, (String(step).split(".")[1] ?? "").length, (String(min).split(".")[1] ?? "").length));
  return Number(snapped.toFixed(decimals));
}

/** 吸附后再夹进 [lo, hi]；吸附把值推出界时回落到界内最近的合法值（边界本身始终合法）。 */
export function snapWithin(value: number, lo: number, hi: number, origin: number, step: number): number {
  if (hi < lo) return lo;
  const clamped = clampNumber(value, lo, hi);
  const snapped = snapToStep(clamped, origin, step);
  if (snapped < lo - EPS) return lo;
  if (snapped > hi + EPS) return hi;
  return clampNumber(snapped, lo, hi);
}

export function secToRatio(sec: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  return clampNumber((sec - min) / (max - min), 0, 1);
}

export function ratioToSec(ratio: number, min: number, max: number): number {
  return min + clampNumber(ratio, 0, 1) * (max - min);
}

export type RangeBounds = { min: number; max: number; step?: number; minGap?: number };

/** 区间模式：移动起点(0)或终点(1)，两端不得互相越过，也不得出界。 */
export function moveRangeThumb(value: readonly [number, number], thumb: 0 | 1, next: number, bounds: RangeBounds): [number, number] {
  const step = bounds.step ?? 0.1;
  const gap = Math.max(0, bounds.minGap ?? 0);
  const start = clampNumber(value[0], bounds.min, bounds.max);
  const end = clampNumber(value[1], start, bounds.max);
  if (thumb === 0) return [snapWithin(next, bounds.min, Math.max(bounds.min, end - gap), bounds.min, step), end];
  return [start, snapWithin(next, Math.min(bounds.max, start + gap), bounds.max, bounds.min, step)];
}

/** 键盘：方向键 ±step，Shift+方向键 ±1 秒，Home/End 到可达范围两端。非滑块按键返回 null。 */
export function keyboardTarget(current: number, key: string, shiftKey: boolean, step: number, lo: number, hi: number): number | null {
  const unit = shiftKey ? 1 : step;
  switch (key) {
    case "ArrowLeft": case "ArrowDown": return current - unit;
    case "ArrowRight": case "ArrowUp": return current + unit;
    case "PageDown": return current - 1;
    case "PageUp": return current + 1;
    case "Home": return lo;
    case "End": return hi;
    default: return null;
  }
}

/** 第 index 与 index+1 段之间的边界可落在的范围（两侧各保留 minLen）。 */
export function segmentBoundaryLimits(segments: readonly RangeTrackSegment[], index: number, minLen = 0): { lo: number; hi: number } | null {
  const left = segments[index]; const right = segments[index + 1];
  if (!left || !right) return null;
  const lo = left.startSec + minLen; const hi = right.endSec - minLen;
  if (hi < lo) return { lo: left.endSec, hi: left.endSec };
  return { lo, hi };
}

export function clampSegmentBoundary(segments: readonly RangeTrackSegment[], index: number, sec: number, opts: { step?: number; minLen?: number; origin?: number } = {}): number | null {
  const limits = segmentBoundaryLimits(segments, index, opts.minLen ?? 0);
  if (!limits) return null;
  return snapWithin(sec, limits.lo, limits.hi, opts.origin ?? segments[0]!.startSec, opts.step ?? 0.1);
}

/** 移动边界并保持首尾相接：只改 index 段的 endSec 与 index+1 段的 startSec，其余段原样返回。 */
export function moveSegmentBoundary<T extends RangeTrackSegment>(segments: readonly T[], index: number, sec: number, opts: { step?: number; minLen?: number; origin?: number } = {}): T[] {
  const next = clampSegmentBoundary(segments, index, sec, opts);
  if (next == null) return segments.slice();
  return segments.map((segment, i) => i === index ? { ...segment, endSec: next } : i === index + 1 ? { ...segment, startSec: next } : segment);
}

export function segmentsAreContiguous(segments: readonly RangeTrackSegment[]): boolean {
  return segments.every((segment, i) => segment.endSec >= segment.startSec && (i === 0 || Math.abs(segment.startSec - segments[i - 1]!.endSec) < 1e-6));
}

export function formatTrackSeconds(sec: number): string {
  return `${Number(sec.toFixed(2))} 秒`;
}
