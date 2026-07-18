import { describe, expect, it } from "vitest";
import {
  buildHtmlPptOutlineUserPrompt,
  parseHtmlPptOutlineJson,
} from "./htmlPptOutlinePrompt";

describe("htmlPptOutlinePrompt", () => {
  it("builds user prompt with page count and style", () => {
    const p = buildHtmlPptOutlineUserPrompt({
      title: "小红书趋势",
      purposeZh: "数据洞察汇报",
      pageCount: 8,
      styleId: "dark_research",
      briefZh: "近7日蓝海词与热搜",
    });
    expect(p).toContain("正好 8 页");
    expect(p).toContain("dark_research");
    expect(p).toContain("近7日蓝海词");
    expect(p).not.toContain("必覆盖槽位");
  });

  it("injects manhua market slot checklist for 漫剧 topics", () => {
    const p = buildHtmlPptOutlineUserPrompt({
      title: "AI漫剧的市场现状与前景",
      purposeZh: "行业路演",
      pageCount: 13,
      styleId: "dark_research",
      briefZh: "DataEye 168亿；红果/抖音政策",
    });
    expect(p).toContain("必覆盖槽位");
    expect(p).toContain("品类供给占比");
    expect(p).toContain("国内 vs 出海");
  });

  it("rejects short outlines when pageCount is required", () => {
    const raw = JSON.stringify({
      deckTitle: "短稿",
      summary: "不够",
      pages: [
        { title: "封面", viz: "cover" },
        { title: "一点", viz: "bars", series: [{ label: "A", value: 1 }] },
      ],
    });
    expect(() => parseHtmlPptOutlineJson(raw, { pageCount: 8 })).toThrow(/页数不足/);
  });

  it("parses llm json into pages with series", () => {
    const raw = JSON.stringify({
      deckTitle: "趋势汇报",
      summary: "主叙事",
      pages: [
        { title: "封面", kpi: "01", viz: "cover", bullets: ["主判断"] },
        {
          title: "关键数据",
          kpi: "72%",
          viz: "ring",
          bullets: ["口径清晰"],
          series: [
            { label: "覆盖", value: 72 },
            { label: "置信", value: 81 },
          ],
        },
        {
          title: "热搜榜",
          viz: "bars",
          series: [
            { label: "词A", value: 90 },
            { label: "词B", value: 70 },
          ],
        },
        { title: "对照", viz: "columns", series: [{ label: "甲", value: 50 }] },
        { title: "下一步", kpi: "GO", viz: "steps", bullets: ["确认", "导出"] },
      ],
    });
    const out = parseHtmlPptOutlineJson(raw, { pageCount: 5 });
    expect(out.deckTitle).toBe("趋势汇报");
    expect(out.pages).toHaveLength(5);
    expect(out.pages[1]?.series?.[0]?.label).toBe("覆盖");
    expect(out.pages[2]?.viz).toBe("bars");
  });

  it("salvages truncated json when enough pages exist", () => {
    const raw = `{
  "deckTitle": "半截稿",
  "summary": "测试",
  "pages": [
    {"title": "封面", "viz": "cover", "kpi": "01"},
    {"title": "占比", "viz": "bars", "series": [{"label": "A", "value": 40}]},
    {"title": "路径", "viz": "steps", "bullets": ["一步", "二步"]},
    {"title": "对照", "viz": "columns", "series": [{"label": "B", "value": 20}]},
    {"title": "收束", "viz": "steps", "bullets": ["下一步"]},
    {"title": "未完成截断", "viz": "line", "series": [{"label": "x", "value": `;
    const out = parseHtmlPptOutlineJson(raw, { pageCount: 5 });
    expect(out.pages.length).toBeGreaterThanOrEqual(5);
    expect(out.deckTitle).toBe("半截稿");
  });

  it("keeps absolute series magnitudes for market charts", () => {
    const raw = JSON.stringify({
      deckTitle: "市场规模",
      summary: "168→244",
      pages: [
        { title: "封面", viz: "cover", kpi: "168亿" },
        {
          title: "规模对照",
          viz: "compare",
          bullets: ["2025", "2026E"],
          series: [
            { label: "市场规模亿元", value: 168 },
            { label: "用户亿人", value: 1.2 },
            { label: "预测亿元", value: 243.6 },
            { label: "用户预测", value: 2.8 },
          ],
        },
        { title: "供给", viz: "bars", series: [{ label: "A", value: 40 }] },
        { title: "渗透", viz: "ring", series: [{ label: "B", value: 35 }] },
        { title: "收束", viz: "steps", bullets: ["备案", "放量"] },
      ],
    });
    const out = parseHtmlPptOutlineJson(raw, { pageCount: 5 });
    expect(out.pages[1]?.viz).toBe("compare");
    expect(out.pages[1]?.series?.[0]?.value).toBe(168);
    expect(out.pages[1]?.series?.[2]?.value).toBe(243.6);
  });
});
