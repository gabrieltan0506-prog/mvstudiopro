import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VisualReportTemplate } from "../components/VisualReportTemplate";
import { mapGenerateVisualReportResult } from "./visualReportMapper";
import { buildIndustryGrowthHintMap, repairTrackGrowthRows, filterTrackGrowthHotOnly } from "../../../server/services/visualReportTrackGrowth";

describe("趋势样本计数到报告展示", () => {
  it("真实计数经修复、序列化与映射后显示对照证据", () => {
    const items = [
      ...Array.from({ length: 3 }, () => ({ publishedAt: "2026-09-09T04:00:00Z", industryLabels: ["家居"] })),
      { publishedAt: "2026-09-05T04:00:00Z", industryLabels: ["家居"] },
      { publishedAt: "2026-09-09T04:00:00Z", industryLabels: ["旅行"] },
    ];
    const hints = buildIndustryGrowthHintMap({ collections: { douyin: { items } } }, ["douyin"], 3, Date.parse("2026-09-09T04:00:00Z"));
    const trackGrowth = filterTrackGrowthHotOnly(repairTrackGrowthRows([
      { name: "家居", growth: "+98%" }, { name: "旅行", growth: "+98%" },
    ], hints));
    const result = JSON.parse(JSON.stringify({ report: { reportTitle: "趋势报告", dateRange: "2026-09-07 – 2026-09-09", trackGrowth } }));
    const mapped = mapGenerateVisualReportResult(result, { windowDays: "3", theme: "light" })!;
    const html = renderToStaticMarkup(React.createElement(VisualReportTemplate, { data: mapped }));
    expect(html).toContain("+200%");
    expect(html).toContain("本期 3 条 / 前期 1 条");
    expect(html).toContain("缺少对照");
    expect(html).not.toContain("+98%");
    expect(html).toContain("选题关键词");
    expect(html).toContain("不代表播放量或平台整体流量增长");
    expect(html.match(/2026-09-07 – 2026-09-09/g)).toHaveLength(2);
  });

  it("历史无口径数据不再把排名百分比或高热显示为统计", () => {
    const mapped = mapGenerateVisualReportResult({ report: { trackGrowth: [
      { name: "旧赛道", growth: "+98%", isHot: true },
      { name: "旧热度", growth: "高热" },
    ] } }, { windowDays: "7", theme: "dark" })!;
    const html = renderToStaticMarkup(React.createElement(VisualReportTemplate, { data: mapped }));
    expect(html.match(/口径未记录/g)).toHaveLength(2);
    expect(html).not.toContain("+98%");
    expect(html).not.toContain("高热");
    expect(html).not.toContain("算法推荐信号");
  });
});
