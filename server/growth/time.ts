export const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

export function toShanghaiIso(input: Date | number | string = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date input: ${String(input)}`);
  }
  return date.toISOString();
}

export function nowShanghaiIso(input: Date | number | string = new Date()) {
  return toShanghaiIso(input);
}

/** 指定上海日曆日 00:00:00 的 UTC 毫秒（上海無夏令時，日與日之間固定 +86400000）。 */
export function shanghaiStartOfDayUtcMs(year: number, month: number, day: number): number {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  const ms = new Date(`${y}-${m}-${d}T00:00:00+08:00`).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid Shanghai calendar date: ${year}-${month}-${day}`);
  }
  return ms;
}

/** 某一瞬間在 Asia/Shanghai 下的公曆年月日。 */
export function getShanghaiCalendarParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: pick("year"), month: pick("month"), day: pick("day") };
}

/** 某一瞬間所屬「上海日」的 00:00:00（上海）對應的 UTC 毫秒。 */
export function shanghaiStartOfLocalDayUtcMs(date: Date): number {
  const { year, month, day } = getShanghaiCalendarParts(date);
  return shanghaiStartOfDayUtcMs(year, month, day);
}

export function formatShanghaiDateZh(ms: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/**
 * 視覺報告 / 賽道樣本對照用時間窗：以上海日曆對齊。
 * - **本期**：含「今天」在內連續 windowDays 個上海日，區間 [currentStart, currentEndExclusive)。
 * - **前期**：緊接本期之前連續 windowDays 個上海日，區間 [priorStart, priorEndExclusive)。
 */
export function getShanghaiVisualReportWindows(windowDays: number, anchorMs = Date.now()) {
  const anchor = new Date(anchorMs);
  const today0 = shanghaiStartOfLocalDayUtcMs(anchor);
  const tomorrow0 = today0 + 86_400_000;
  const currentStart = today0 - (windowDays - 1) * 86_400_000;
  const currentEndExclusive = tomorrow0;
  const priorEndExclusive = currentStart;
  const priorStart = currentStart - windowDays * 86_400_000;
  return { currentStart, currentEndExclusive, priorStart, priorEndExclusive };
}
