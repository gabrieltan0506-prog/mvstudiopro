/**
 * /platform 趋势图文报表本机键（已停用「刷新不丢」）。
 * PlatformPage 进页/重跑会 clear；保留 read/write 仅供测试与一次性清旧数据。
 */

import type { VisualReportData } from "@/components/VisualReportTemplate";

export const PLATFORM_VISUAL_REPORT_LS_KEY = "mvstudiopro.platform.visualReport.v1";

export type PlatformVisualReportPersistV1 = {
  v: 1;
  savedAt: string;
  /** PNG 长图数据；可与看板不同步到达 */
  visualReport: VisualReportData | null;
  /** 同一次趋势分析的看板（有则一起恢复） */
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

/** 看板体积可能很大；持久化只留趋势页恢复所需字段，降低配额写失败 */
export function slimPlatformDashboardForPersist(raw: unknown): unknown | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const keep: Record<string, unknown> = {};
  for (const key of [
    "headline",
    "subheadline",
    "topSignals",
    "platformMenu",
    "personaSummary",
    "conversationStarters",
    "aiManhuaRising",
    "aiManhuaRisingByPlatform",
    "hotTopics",
    "trackGrowth",
  ]) {
    if (key in d) keep[key] = d[key];
  }
  return Object.keys(keep).length ? keep : null;
}

export function readPlatformVisualReportPersist(
  storage: Pick<Storage, "getItem"> = localStorage,
): PlatformVisualReportPersistV1 | null {
  try {
    const raw = storage.getItem(PLATFORM_VISUAL_REPORT_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlatformVisualReportPersistV1;
    if (!parsed || parsed.v !== 1) return null;
    const report =
      parsed.visualReport != null && isVisualReportShape(parsed.visualReport)
        ? parsed.visualReport
        : null;
    const dash = parsed.platformDashboard ?? null;
    if (!report && dash == null) return null;
    return {
      v: 1,
      savedAt: String(parsed.savedAt || ""),
      visualReport: report,
      platformDashboard: dash,
      windowDays: parsed.windowDays != null ? String(parsed.windowDays) : undefined,
    };
  } catch {
    return null;
  }
}

export function writePlatformVisualReportPersist(
  input: {
    visualReport?: VisualReportData | null;
    platformDashboard?: unknown | null;
    windowDays?: string;
  },
  storage: Pick<Storage, "setItem" | "removeItem" | "getItem"> = localStorage,
): boolean {
  // 合并写入：只更新本次传入的字段，避免看板先到时把已存报表冲掉
  const prev = readPlatformVisualReportPersist(storage);
  const nextReport =
    input.visualReport !== undefined
      ? input.visualReport && isVisualReportShape(input.visualReport)
        ? input.visualReport
        : null
      : prev?.visualReport ?? null;
  const nextDash =
    input.platformDashboard !== undefined
      ? slimPlatformDashboardForPersist(input.platformDashboard)
      : prev?.platformDashboard ?? null;
  const nextWindow =
    input.windowDays !== undefined ? input.windowDays : prev?.windowDays;

  if (!nextReport && nextDash == null) {
    try {
      storage.removeItem(PLATFORM_VISUAL_REPORT_LS_KEY);
    } catch {
      /* ignore */
    }
    return false;
  }

  const payload: PlatformVisualReportPersistV1 = {
    v: 1,
    savedAt: new Date().toISOString(),
    visualReport: nextReport,
    platformDashboard: nextDash,
    windowDays: nextWindow,
  };

  const tryWrite = (body: PlatformVisualReportPersistV1) => {
    storage.setItem(PLATFORM_VISUAL_REPORT_LS_KEY, JSON.stringify(body));
  };

  try {
    tryWrite(payload);
    return true;
  } catch {
    // 配额满：先丢掉看板只保报表
    if (payload.visualReport) {
      try {
        tryWrite({
          v: 1,
          savedAt: payload.savedAt,
          visualReport: payload.visualReport,
          windowDays: payload.windowDays,
        });
        return true;
      } catch {
        /* fall through */
      }
    }
    // 再试：只保瘦身后的看板
    if (payload.platformDashboard != null) {
      try {
        tryWrite({
          v: 1,
          savedAt: payload.savedAt,
          visualReport: null,
          platformDashboard: payload.platformDashboard,
          windowDays: payload.windowDays,
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
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
