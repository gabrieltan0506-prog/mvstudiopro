import { describe, expect, it } from "vitest";
import {
  buildHtmlPptOutlineUserPrompt,
  buildHtmlPptThemeSuggestUserPrompt,
  parseHtmlPptOutlineJson,
  parseHtmlPptThemeSuggestJson,
} from "./htmlPptOutlinePrompt";

describe("htmlPptOutlinePrompt", () => {
  it("builds user prompt with page count and style", () => {
    const p = buildHtmlPptOutlineUserPrompt({
      title: "小红书趋势",
      purposeZh: "数据洞察汇报",
      pageCount: 10,
      styleId: "dark_research",
      briefZh: "近7日蓝海词与热搜",
    });
    expect(p).toContain("正好 10 页");
    expect(p).toContain("dark_research");
    expect(p).toContain("近7日蓝海词");
    expect(p).not.toContain("必覆盖槽位");
  });

  it("includes confirmed themes in user prompt", () => {
    const p = buildHtmlPptOutlineUserPrompt({
      title: "AI 趋势",
      pageCount: 12,
      styleId: "dark_research",
      confirmedThemes: [
        { id: "market", title: "市场规模" },
        { id: "forecast", title: "2026 预测" },
        { id: "risk", title: "风险清单" },
      ],
    });
    expect(p).toContain("themeId=market → 可见标题「市场规模」");
    expect(p).toContain("P1 必须是目录");
  });

  it("builds theme suggest prompt with user themes", () => {
    const p = buildHtmlPptThemeSuggestUserPrompt({
      title: "漫剧市场",
      userThemes: ["市场规模", "竞争格局", "政策风险"],
    });
    expect(p).toContain("市场规模");
    expect(p).toContain("补 3–4 个互补主题");
  });

  it("parses theme suggest json", () => {
    const raw = JSON.stringify({
      polishedTitle: "AI 漫剧市场全景",
      suggestedThemes: [
        { id: "supply", title: "供给结构" },
        { id: "forecast", title: "2026 预测" },
        { id: "risk", title: "合规风险" },
      ],
    });
    const out = parseHtmlPptThemeSuggestJson(raw);
    expect(out.polishedTitle).toBe("AI 漫剧市场全景");
    expect(out.suggestedThemes).toHaveLength(3);
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
    expect(() => parseHtmlPptOutlineJson(raw, { pageCount: 10 })).toThrow(/页数不足/);
  });

  it("parses llm json into pages with series and theme fields", () => {
    const pages = Array.from({ length: 10 }, (_, i) => {
      if (i === 0) return { title: "封面", kpi: "01", viz: "cover", bullets: ["主判断"] };
      if (i === 1) {
        return {
          title: "关键数据",
          kpi: "72%",
          viz: "ring",
          themeId: "market",
          themeTitle: "市场规模",
          highlight: ["72% 渗透"],
          bullets: ["口径清晰"],
          series: [
            { label: "覆盖", value: 72 },
            { label: "置信", value: 81 },
          ],
        };
      }
      if (i === 2) {
        return {
          title: "热搜榜",
          viz: "bars",
          series: [
            { label: "词A", value: 90 },
            { label: "词B", value: 70 },
          ],
        };
      }
      if (i === 3) return { title: "对照", viz: "columns", series: [{ label: "甲", value: 50 }] };
      if (i === 4) return { title: "表格", viz: "table", series: [{ label: "A", value: 1 }] };
      return { title: `页${i + 1}`, viz: "steps", bullets: ["要点"] };
    });
    const raw = JSON.stringify({ deckTitle: "趋势汇报", summary: "主叙事", pages });
    const out = parseHtmlPptOutlineJson(raw, { pageCount: 10 });
    expect(out.deckTitle).toBe("趋势汇报");
    expect(out.pages).toHaveLength(10);
    expect(out.pages[1]?.series?.[0]?.label).toBe("覆盖");
    expect(out.pages[1]?.themeId).toBe("market");
    expect(out.pages[1]?.highlight?.[0]).toBe("72% 渗透");
    expect(out.pages[2]?.viz).toBe("bars");
    expect(out.pages[4]?.viz).toBe("table");
  });

  it("salvages truncated json when enough pages exist", () => {
    const completePages = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ title: `页${i + 1}`, viz: "steps", bullets: ["一步"] }),
    );
    const raw = `{
  "deckTitle": "半截稿",
  "summary": "测试",
  "pages": [
    ${completePages.join(",\n    ")},
    {"title": "未完成截断", "viz": "line", "series": [{"label": "x", "value": 
  ]
}`;
    const out = parseHtmlPptOutlineJson(raw, { pageCount: 10 });
    expect(out.pages.length).toBeGreaterThanOrEqual(10);
    expect(out.deckTitle).toBe("半截稿");
  });

  it("keeps absolute series magnitudes for market charts", () => {
    const tail = Array.from({ length: 8 }, (_, i) => ({
      title: `页${i + 3}`,
      viz: "steps" as const,
      bullets: ["下一步"],
    }));
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
        ...tail,
      ],
    });
    const out = parseHtmlPptOutlineJson(raw, { pageCount: 10 });
    expect(out.pages[1]?.viz).toBe("compare");
    expect(out.pages[1]?.series?.[0]?.value).toBe(168);
    expect(out.pages[1]?.series?.[2]?.value).toBe(243.6);
  });
});
