import { describe, expect, it } from "vitest";
import {
  clearPlatformVisualReportPersist,
  readPlatformVisualReportPendingJob,
  readPlatformVisualReportPersist,
  resolvePlatformVisualReportPendingJob,
  shouldRestoreLatestVisualReport,
  slimPlatformDashboardForPersist,
  writePlatformVisualReportPersist,
  writePlatformVisualReportPendingJob,
} from "./platformVisualReportPersist";
import type { VisualReportData } from "@/components/VisualReportTemplate";

function sampleReport(): VisualReportData {
  return {
    reportTitle: "测试趋势报告",
    dateRange: "7月26日 – 8月1日",
    theme: "dark",
    insightSummary: [{ role: "判断", title: "暑期", description: "生活方式升温" }],
    platformDetails: [
      {
        platform: "xiaohongshu",
        displayName: "小红书",
        trafficBoosters: [],
        cashRewards: [],
        hotTopics: ["教程"],
      },
    ],
  };
}

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

describe("platformVisualReportPersist", () => {
  it("round-trips visual report + dashboard", () => {
    const storage = memoryStorage();
    const report = sampleReport();
    expect(
      writePlatformVisualReportPersist(
        { visualReport: report, platformDashboard: { headline: "ok", huge: "x".repeat(10) }, windowDays: "7" },
        storage,
      ),
    ).toBe(true);
    const loaded = readPlatformVisualReportPersist(storage);
    expect(loaded?.visualReport?.reportTitle).toBe("测试趋势报告");
    expect(loaded?.platformDashboard).toEqual({ headline: "ok" });
    expect(loaded?.windowDays).toBe("7");
  });

  it("merges dashboard-only write without wiping prior report", () => {
    const storage = memoryStorage();
    writePlatformVisualReportPersist({ visualReport: sampleReport() }, storage);
    writePlatformVisualReportPersist({ platformDashboard: { headline: "后到看板" } }, storage);
    const loaded = readPlatformVisualReportPersist(storage);
    expect(loaded?.visualReport?.reportTitle).toBe("测试趋势报告");
    expect((loaded?.platformDashboard as { headline?: string })?.headline).toBe("后到看板");
  });

  it("accepts dashboard-only persist", () => {
    const storage = memoryStorage();
    expect(
      writePlatformVisualReportPersist({ platformDashboard: { topSignals: ["a"] } }, storage),
    ).toBe(true);
    const loaded = readPlatformVisualReportPersist(storage);
    expect(loaded?.visualReport).toBeNull();
    expect(loaded?.platformDashboard).toEqual({ topSignals: ["a"] });
  });

  it("rejects malformed payload with neither report nor dashboard", () => {
    const storage = memoryStorage({
      "mvstudiopro.platform.visualReport.v1": JSON.stringify({ v: 1, visualReport: { foo: 1 } }),
    });
    expect(readPlatformVisualReportPersist(storage)).toBeNull();
  });

  it("slim drops heavy fields", () => {
    expect(
      slimPlatformDashboardForPersist({
        headline: "h",
        contentBlueprints: [{ x: 1 }],
        monetizationLanes: [],
      }),
    ).toEqual({ headline: "h" });
  });

  it("clear removes key", () => {
    const storage = memoryStorage();
    writePlatformVisualReportPersist({ visualReport: sampleReport() }, storage);
    clearPlatformVisualReportPersist(storage);
    expect(readPlatformVisualReportPersist(storage)).toBeNull();
  });

  it("round-trips an unfinished report job for the same user", () => {
    const storage = memoryStorage();
    writePlatformVisualReportPendingJob({
      v: 1,
      jobId: "trend_42_request",
      userId: "42",
      windowDays: "7",
      theme: "dark",
      createdAt: 1_000,
    }, storage);
    expect(readPlatformVisualReportPendingJob("42", storage, 2_000)?.jobId).toBe("trend_42_request");
    expect(readPlatformVisualReportPendingJob("43", storage, 2_000)).toBeNull();
  });

  it("drops expired or malformed pending report jobs", () => {
    const storage = memoryStorage({
      "mvstudiopro.platform.visualReportJob.v1": JSON.stringify({
        v: 1,
        jobId: "trend_42_old",
        userId: "42",
        windowDays: "7",
        theme: "dark",
        createdAt: 1,
      }),
    });
    expect(readPlatformVisualReportPendingJob("42", storage, 25 * 60 * 60_000)).toBeNull();
  });

  it("uses the server latest job instead of a stale local pending job after refresh", () => {
    const saved = {
      v: 1,
      jobId: "trend_42_old",
      userId: "42",
      windowDays: "7",
      theme: "dark",
      createdAt: 1_000,
    } as const;
    const resolved = resolvePlatformVisualReportPendingJob({
      saved,
      latestJobId: "trend_42_new",
      userId: "42",
      windowDays: "15",
      theme: "light",
      createdAt: 2_000,
    });
    expect(resolved).toEqual({
      v: 1,
      jobId: "trend_42_new",
      userId: "42",
      windowDays: "15",
      theme: "light",
      createdAt: 2_000,
    });
  });

  it("never restores an old success while a rerun is pending or has failed", () => {
    const base = {
      currentUserId: "42",
      responseUserId: "42",
      hasCurrentReport: false,
      busy: false,
    };
    expect(shouldRestoreLatestVisualReport({ ...base, hasPendingJob: true, hasCurrentError: false })).toBe(false);
    expect(shouldRestoreLatestVisualReport({ ...base, hasPendingJob: false, hasCurrentError: true })).toBe(false);
    expect(shouldRestoreLatestVisualReport({ ...base, hasPendingJob: false, hasCurrentError: false })).toBe(true);
    expect(shouldRestoreLatestVisualReport({
      ...base,
      responseUserId: "43",
      hasPendingJob: false,
      hasCurrentError: false,
    })).toBe(false);
  });
});
