/**
 * 图库素材裁点（2026-11-08 素材检索 UX 第二期）：抽屉里的入点/出点拖柄、
 * 各业务线绑定写入与最终合成都用这两个纯函数，保证「界面看到的窗口 = 写进数据的窗口 = 合成读取的帧」。
 *
 * 约定：
 * - 时间单位为秒，内部按毫秒整数计算，避免浮点累加把出点推到素材末尾之外。
 * - 窗口长度默认等于镜头/段落目标时长，但永远不超过素材时长；素材短于目标时窗口 = 整段素材，
 *   并用 shortBySec 报告短了多少秒（候选保留，由界面提示「短于镜头 N 秒」）。
 * - 入点越界时夹回 [0, 素材时长 - 窗口]，不抛错：拖柄拖过头是正常交互。
 */

export type StockTrim = { inSec: number; outSec: number };
export type StockTrimClampResult = StockTrim & { shortBySec: number };

/** 默认最短窗口（秒）：防止两只拖柄重叠成 0 长度片段。 */
export const STOCK_TRIM_MIN_SEC = 0.5;
export const STOCK_TRIM_DEFAULT_FPS = 30;

function finiteNonNegative(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

const toMs = (sec: number) => Math.floor(sec * 1000 + 1e-6);
const toSec = (ms: number) => ms / 1000;

export function clampStockTrim(input: { sourceSec: number; targetSec?: number; inSec?: number; minSec?: number }): StockTrimClampResult {
  const sourceSec = finiteNonNegative(input.sourceSec) ?? 0;
  const targetSec = finiteNonNegative(input.targetSec);
  const sourceMs = toMs(sourceSec);
  const targetMs = targetSec !== undefined && targetSec > 0 ? toMs(targetSec) : undefined;
  const shortByMs = targetMs !== undefined ? Math.max(0, targetMs - sourceMs) : 0;

  // 素材没有时长（照片或元数据缺失）：没有可裁的时间轴。
  if (sourceMs <= 0) return { inSec: 0, outSec: 0, shortBySec: toSec(shortByMs) };

  const minMs = Math.min(sourceMs, toMs(finiteNonNegative(input.minSec) ?? STOCK_TRIM_MIN_SEC));
  const windowMs = Math.max(minMs, Math.min(targetMs ?? sourceMs, sourceMs));
  const wantedInMs = toMs(finiteNonNegative(input.inSec) ?? 0);
  const inMs = Math.min(Math.max(0, wantedInMs), sourceMs - windowMs);
  return { inSec: toSec(inMs), outSec: toSec(inMs + windowMs), shortBySec: toSec(shortByMs) };
}

/**
 * 秒 → 帧（默认 30fps）。入点与出点都向下取整到帧，时长 = 出点帧 - 入点帧，
 * 因此 sourceInFrame + durationFrames 永远不超过 floor(outSec × fps)，不会读到素材末尾之外。
 */
export function stockTrimToFrames(trim: StockTrim, fps: number = STOCK_TRIM_DEFAULT_FPS): { sourceInFrame: number; durationFrames: number } {
  const rate = Number.isFinite(fps) && fps > 0 ? fps : STOCK_TRIM_DEFAULT_FPS;
  const inSec = finiteNonNegative(trim.inSec) ?? 0;
  const outSec = Math.max(inSec, finiteNonNegative(trim.outSec) ?? 0);
  const sourceInFrame = Math.floor(inSec * rate + 1e-6);
  const outFrame = Math.floor(outSec * rate + 1e-6);
  return { sourceInFrame, durationFrames: Math.max(0, outFrame - sourceInFrame) };
}
