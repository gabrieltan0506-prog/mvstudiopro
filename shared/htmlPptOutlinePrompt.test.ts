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
        { title: "下一步", kpi: "GO", viz: "steps", bullets: ["确认", "导出"] },
      ],
    });
    const out = parseHtmlPptOutlineJson(raw, { pageCount: 4 });
    expect(out.deckTitle).toBe("趋势汇报");
    expect(out.pages).toHaveLength(4);
    expect(out.pages[1]?.series?.[0]?.label).toBe("覆盖");
    expect(out.pages[2]?.viz).toBe("bars");
  });
});
