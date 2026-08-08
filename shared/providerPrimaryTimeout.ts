/**
 * 主路径超时 → 立刻 fallback（体验优先，可接受多花一点上游成本）。
 * 底层请求可能仍在飞；不强制 abort 远端（fetch Abort 已尽量传）。
 */

export function readPositiveMs(envName: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[envName] || "");
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

/** GPT-5.6 官方主路径等待上限；超时切 EvoLink。默认 75s。 */
export function getGpt56PrimaryTimeoutMs(): number {
  return readPositiveMs("GPT56_PRIMARY_TIMEOUT_MS", 75_000, 15_000, 300_000);
}

/** GPT-image-2 便宜主路径等待上限；超时切备胎。默认 90s。 */
export function getGptImage2PrimaryTimeoutMs(): number {
  return readPositiveMs("GPT_IMAGE2_PRIMARY_TIMEOUT_MS", 90_000, 20_000, 300_000);
}

export function isTimeoutLikeError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error || "");
  if (!msg) return false;
  return /timeout|timed?\s*out|aborted|AbortError|超时|524/i.test(msg);
}

/**
 * 与主任务竞速：超时抛错，调用方应 catch 后走 fallback。
 * 注意：未取消的底层 Promise 可能继续跑完（用户接受「顶多少赚一点」）。
 */
export async function racePrimaryTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} 主路径超时（${timeoutMs}ms），切换备胎`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
