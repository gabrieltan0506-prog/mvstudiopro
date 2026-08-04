/**
 * 成片左上角合规角标（如「AI生成」）修补区。
 * 比例相对画幅；服务端 ffmpeg delogo 用像素矩形。
 */

export type AiCornerMarkRoiPx = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/** 默认：左上角条带，覆盖常见「AI生成」半透明标，不裁整幅 */
export const AI_CORNER_MARK_ROI_FRAC = {
  x: 0.006,
  y: 0.008,
  w: 0.17,
  h: 0.065,
} as const;

function evenFloor(n: number): number {
  const v = Math.floor(n);
  return v % 2 === 0 ? v : v - 1;
}

function evenCeil(n: number, max: number): number {
  let v = Math.ceil(n);
  if (v % 2 !== 0) v += 1;
  return Math.min(max, v);
}

/**
 * 按画幅算出 delogo 矩形（像素，尽量偶数，且落在画面内）。
 */
export function computeAiCornerMarkRoiPx(
  width: number,
  height: number,
  frac: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  } = AI_CORNER_MARK_ROI_FRAC,
): AiCornerMarkRoiPx {
  const W = Math.max(2, Math.floor(Number(width) || 0));
  const H = Math.max(2, Math.floor(Number(height) || 0));
  const fx = Number.isFinite(frac.x) ? Number(frac.x) : AI_CORNER_MARK_ROI_FRAC.x;
  const fy = Number.isFinite(frac.y) ? Number(frac.y) : AI_CORNER_MARK_ROI_FRAC.y;
  const fw = Number.isFinite(frac.w) ? Number(frac.w) : AI_CORNER_MARK_ROI_FRAC.w;
  const fh = Number.isFinite(frac.h) ? Number(frac.h) : AI_CORNER_MARK_ROI_FRAC.h;

  let x = evenFloor(W * Math.min(0.2, Math.max(0, fx)));
  let y = evenFloor(H * Math.min(0.2, Math.max(0, fy)));
  let w = evenCeil(W * Math.min(0.45, Math.max(0.04, fw)), W - x);
  let h = evenCeil(H * Math.min(0.25, Math.max(0.03, fh)), H - y);

  // delogo 要求区在画面内且宽高 ≥ 1
  if (x + w >= W) w = evenFloor(W - x - 2) || 2;
  if (y + h >= H) h = evenFloor(H - y - 2) || 2;
  if (w < 2) w = 2;
  if (h < 2) h = 2;
  if (x < 0) x = 0;
  if (y < 0) y = 0;

  return { x, y, w, h };
}

export function formatDelogoFilter(roi: AiCornerMarkRoiPx): string {
  return `delogo=x=${roi.x}:y=${roi.y}:w=${roi.w}:h=${roi.h}:show=0`;
}
