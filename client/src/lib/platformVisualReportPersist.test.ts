import { describe, expect, it } from "vitest";
import {
  clearPlatformVisualReportPersist,
  readPlatformVisualReportPersist,
  writePlatformVisualReportPersist,
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
        { visualReport: report, platformDashboard: { ok: true }, windowDays: "7" },
        storage,
      ),
    ).toBe(true);
    const loaded = readPlatformVisualReportPersist(storage);
    expect(loaded?.visualReport.reportTitle).toBe("测试趋势报告");
    expect(loaded?.platformDashboard).toEqual({ ok: true });
    expect(loaded?.windowDays).toBe("7");
  });

  it("rejects malformed payload", () => {
    const storage = memoryStorage({
      "mvstudiopro.platform.visualReport.v1": JSON.stringify({ v: 1, visualReport: { foo: 1 } }),
    });
    expect(readPlatformVisualReportPersist(storage)).toBeNull();
  });

  it("clear removes key", () => {
    const storage = memoryStorage();
    writePlatformVisualReportPersist({ visualReport: sampleReport() }, storage);
    clearPlatformVisualReportPersist(storage);
    expect(readPlatformVisualReportPersist(storage)).toBeNull();
  });
});
