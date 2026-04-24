import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const TZ = "Asia/Shanghai"; // GMT+8

/** 格式化日期為 GMT+8，例：2026/04/25 04:55 */
export function formatDateGMT8(date: Date | string | null | undefined, opts?: { showTime?: boolean }): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "-";
  const showTime = opts?.showTime ?? true;
  return d.toLocaleString("zh-TW", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(showTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  });
}

/** 取得目前 GMT+8 時間的本地化日期字串，用於標題 */
export function nowDateLabelGMT8(): string {
  return new Date().toLocaleDateString("zh-TW", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
