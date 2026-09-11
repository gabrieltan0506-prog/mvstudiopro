import { describe, expect, it } from "vitest";
import {
  buildVisualReportDateRange,
  fallbackBlueOceanWords,
  mapGenerateVisualReportResult,
  normalizeBlueOceanWords,
} from "./visualReportMapper";

describe("normalizeBlueOceanWords", () => {
  it("accepts structured primary/secondary", () => {
    expect(
      normalizeBlueOceanWords([{ primary: "亲子旅行清单", secondary: ["带娃神器", "行李箱"] }]),
    ).toEqual([{ primary: "亲子旅行清单", secondary: ["带娃神器", "行李箱"] }]);
  });

  it("accepts flat string[] so PNG 蓝海栏不会整段消失", () => {
    expect(normalizeBlueOceanWords(["视觉方法笔记", "可收藏清单"])).toEqual([
      { primary: "视觉方法笔记", secondary: [] },
      { primary: "可收藏清单", secondary: [] },
    ]);
  });
});

describe("mapGenerateVisualReportResult", () => {
  it("falls back to trackGrowth names when globalBlueOceanWords missing", () => {
    const mapped = mapGenerateVisualReportResult(
      {
        report: {
          reportTitle: "测试趋势",
          insightSummary: [],
          trackGrowth: [{ name: "居家收纳", growth: "+12%", isHot: true }],
          platformDetails: [{ platform: "xiaohongshu", hotTopics: ["安静收纳"] }],
        },
      },
      { windowDays: "7", theme: "dark" },
    );
    expect(mapped?.globalBlueOceanWords?.some((b) => b.primary === "居家收纳")).toBe(true);
  });

  it("synthesizes platformDetails from trackGrowth when model omits the card", () => {
    const mapped = mapGenerateVisualReportResult(
      {
        report: {
          reportTitle: "空平台明细兜底",
          insightSummary: ["洞察一句"],
          trackGrowth: [
            { name: "周末短途", growth: "+18%", isHot: true },
            { name: "咖啡探店", growth: "+9%", isHot: false },
          ],
          platformDetails: [],
        },
      },
      { windowDays: "3", theme: "dark" },
    );
    expect(mapped?.platformDetails?.length).toBeGreaterThan(0);
    expect(mapped?.platformDetails?.[0]).toMatchObject({
      platform: "", displayName: "所选平台", hotTopics: ["周末短途", "咖啡探店"],
    });
  });

  it("缺失平台和热点时保留空数组，不猜平台或生成占位热点", () => {
    const mapped = mapGenerateVisualReportResult({ report: {} }, { windowDays: "7", theme: "dark" });
    expect(mapped?.platformDetails[0]).toMatchObject({
      platform: "", displayName: "所选平台", hotTopics: [],
    });
  });

  it("已知平台身份和真实热点保持原值", () => {
    const mapped = mapGenerateVisualReportResult({ report: {
      platformDetails: [{ platform: "douyin", hotTopics: ["城市夜跑"] }],
    } }, { windowDays: "7", theme: "dark" });
    expect(mapped?.platformDetails[0]).toMatchObject({
      platform: "douyin", displayName: "抖音", hotTopics: ["城市夜跑"],
    });
  });

  it("does not expose removed cover candidates in the report DTO", () => {
    const mapped = mapGenerateVisualReportResult(
      {
        report: {
          reportTitle: "无封面趋势报表",
          insightSummary: [],
          trackGrowth: [],
          platformDetails: [{ platform: "xiaohongshu", hotTopics: ["教程"] }],
          excellentCoverReferences: [{ sourceId: "secret", coverUrl: "https://example.invalid/a.jpg" }],
          legacyCoverReferences: [{ sourceId: "legacy" }],
        },
      },
      { windowDays: "7", theme: "dark" },
    );
    expect(mapped).not.toHaveProperty("excellentCoverReferences");
    expect(mapped).not.toHaveProperty("legacyCoverReferences");
  });
});

describe("fallbackBlueOceanWords", () => {
  it("aggregates platform blue ocean first", () => {
    const words = fallbackBlueOceanWords({
      trackGrowth: [{ name: "赛道甲" }],
      platformDetails: [
        { blueOceanWords: [{ primary: "蓝海乙", secondary: ["子词"] }], hotTopics: ["热词丙"] },
      ],
    });
    expect(words[0]?.primary).toBe("蓝海乙");
  });

  it("falls back from long hotTopics (>18) via short label", () => {
    const words = fallbackBlueOceanWords({
      trackGrowth: [],
      platformDetails: [
        {
          hotTopics: ["极简生活收纳：租房也能空出一间书房的方法合集"],
          blueOceanWords: [],
        },
      ],
    });
    expect(words.length).toBeGreaterThan(0);
    expect(words[0]?.primary.length).toBeGreaterThanOrEqual(2);
  });
});


describe("趋势报告日期恢复", () => {
  it.each([
    ["3", "2026/09/09"],
    ["7", "2026/09/05"],
    ["15", "2026/08/28"],
    ["30", "2026/08/13"],
  ] as const)("%s 日含首尾共指定天数", (days, start) => {
    expect(buildVisualReportDateRange(days, "2026-09-11T04:00:00Z"))
      .toBe(`${start} – 2026/09/11`);
  });

  it("按上海午夜换日，不按浏览器本地或 UTC 换日", () => {
    expect(buildVisualReportDateRange("3", "2026-09-10T15:59:59Z"))
      .toBe("2026/09/08 – 2026/09/10");
    expect(buildVisualReportDateRange("3", "2026-09-10T16:00:00Z"))
      .toBe("2026/09/09 – 2026/09/11");
  });

  it("恢复优先保留服务端实际窗口，忽略当前选择和任务创建日", () => {
    const mapped = mapGenerateVisualReportResult({ report: {
      dateRange: "2026/08/26 – 2026/09/01",
      reportTitle: "平台趋势报告 · 近7天 · 2026/08/26 – 2026/09/01",
    } }, { windowDays: "3", theme: "dark", createdAt: "2026-09-10T16:00:00Z" });
    expect(mapped?.dateRange).toBe("2026/08/26 – 2026/09/01");
    expect(mapped?.reportTitle).toBe("平台趋势报告 · 近7天 · 2026/08/26 – 2026/09/01");
  });

  it("旧任务用已保存的创建时间恢复，不使用查看时的今天", () => {
    const mapped = mapGenerateVisualReportResult({ report: { reportTitle: "旧标题 2026/08/25–2026/09/01" } }, {
      windowDays: "7", theme: "dark", createdAt: Date.parse("2026-08-31T16:00:00Z"),
    });
    expect(mapped?.dateRange).toBe("2026/08/26 – 2026/09/01（按任务创建日期恢复）");
    expect(mapped?.reportTitle).toBe("平台趋势报告 · 近7天");
  });

  it.each([undefined, null, "", "invalid"])("旧任务缺少有效日期 %s 时明确缺失", (createdAt) => {
    const mapped = mapGenerateVisualReportResult({ report: {} }, {
      windowDays: "7", theme: "dark", createdAt,
    });
    expect(mapped?.dateRange).toBe("日期区间未记录");
  });
});
