/** 取段按真实源时长校验；不悄悄夹取越界输入。 */
export function resolvePostProdClipEdit(durationSec: number, edit?: { startSec: number; endSec?: number }) {
  const startSec = edit?.startSec ?? 0;
  const endSec = edit?.endSec ?? durationSec;
  if (!Number.isFinite(durationSec) || durationSec <= 0 || !Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec > durationSec + 0.001 || endSec - startSec < 0.1)
    throw new Error("剪辑取段须在原片范围内，且至少保留0.1秒");
  return { startSec, endSec, durationSec: endSec - startSec };
}
