/**
 * /platform 趋势图文报表本机持久化：刷新不丢。
 * 只存 JSON 结构化数据；渲染走 VisualReportTemplate（含爱马仕橙暖底）。
 */

import type { VisualReportData } from "@/components/VisualReportTemplate";

export const PLATFORM_VISUAL_REPORT_LS_KEY = "mvstudiopro.platform.visualReport.v1";

export type PlatformVisualReportPersistV1 = {
  v: 1;
  savedAt: string;
  visualReport: VisualReportData;
  /** 同一次趋势分析的看板（有则一起恢复，避免只剩长图） */
  platformDashboard?: unknown | null;
  windowDays?: string;
};

function isVisualReportShape(raw: unknown): raw is VisualReportData {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return (
    typeof o.reportTitle === "string" &&
    typeof o.dateRange === "string" &&
    Array.isArray(o.insightSummary) &&
    Array.isArray(o.platformDetails)
  );
}

export function readPlatformVisualReportPersist(
  storage: Pick<Storage, "getItem"> = localStorage,
): PlatformVisualReportPersistV1 | null {
  try {
    const raw = storage.getItem(PLATFORM_VISUAL_REPORT_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlatformVisualReportPersistV1;
    if (!parsed || parsed.v !== 1 || !isVisualReportShape(parsed.visualReport)) return null;
    return {
      v: 1,
      savedAt: String(parsed.savedAt || ""),
      visualReport: parsed.visualReport,
      platformDashboard: parsed.platformDashboard ?? null,
      windowDays: parsed.windowDays != null ? String(parsed.windowDays) : undefined,
    };
  } catch {
    return null;
  }
}

export function writePlatformVisualReportPersist(
  input: {
    visualReport: VisualReportData;
    platformDashboard?: unknown | null;
    windowDays?: string;
  },
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
): boolean {
  const payload: PlatformVisualReportPersistV1 = {
    v: 1,
    savedAt: new Date().toISOString(),
    visualReport: input.visualReport,
    platformDashboard: input.platformDashboard ?? null,
    windowDays: input.windowDays,
  };
  try {
    storage.setItem(PLATFORM_VISUAL_REPORT_LS_KEY, JSON.stringify(payload));
    return true;
  } catch {
    // 配额满：丢掉看板只保报表本体再试一次
    try {
      storage.setItem(
        PLATFORM_VISUAL_REPORT_LS_KEY,
        JSON.stringify({
          v: 1,
          savedAt: payload.savedAt,
          visualReport: input.visualReport,
        } satisfies PlatformVisualReportPersistV1),
      );
      return true;
    } catch {
      return false;
    }
  }
}

export function clearPlatformVisualReportPersist(
  storage: Pick<Storage, "removeItem"> = localStorage,
): void {
  try {
    storage.removeItem(PLATFORM_VISUAL_REPORT_LS_KEY);
  } catch {
    /* ignore */
  }
}
