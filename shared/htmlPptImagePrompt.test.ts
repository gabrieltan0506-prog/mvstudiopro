import { describe, expect, it } from "vitest";
import {
  buildHtmlPptSlideImagePrompt,
  recommendHtmlPptImageTemplateId,
  resolveHtmlPptImageTemplateId,
} from "./htmlPptImagePrompt";
import type { HtmlPptPage } from "./htmlPptMaker";

describe("htmlPptImagePrompt", () => {
  const hubPage: HtmlPptPage = {
    title: "平台生态枢纽",
    themeTitle: "生态板块",
    bullets: ["供给端", "分发端", "变现闭环"],
    series: [
      { label: "供给", value: 82 },
      { label: "分发", value: 74 },
      { label: "变现", value: 68 },
    ],
    viz: "hub",
  };

  it("recommends hub template for ecosystem pages", () => {
    expect(recommendHtmlPptImageTemplateId(hubPage)).toBe("infographic_business_ecosystem");
  });

  it("recommends timeline for forecast pages", () => {
    const page: HtmlPptPage = {
      title: "2026 市场规模预测",
      bullets: ["Q1 试点", "Q2 放量", "Q3 规模化"],
      viz: "line",
    };
    expect(recommendHtmlPptImageTemplateId(page)).toBe("infographic_evolution_timeline");
  });

  it("resolves auto to recommendation", () => {
    expect(resolveHtmlPptImageTemplateId("auto", hubPage)).toBe("infographic_business_ecosystem");
    expect(resolveHtmlPptImageTemplateId("", hubPage)).toBe("infographic_business_ecosystem");
  });

  it("builds slide image prompt with layout lock and page content", () => {
    const prompt = buildHtmlPptSlideImagePrompt({
      templateId: "auto",
      deckTitle: "AI 漫剧市场",
      page: {
        title: "竞争格局对照",
        kpi: "TOP3",
        bullets: ["国内平台", "出海渠道", "付费转化"],
        series: [
          { label: "国内", value: 88 },
          { label: "出海", value: 62 },
        ],
        highlight: ["付费转化"],
      },
    });
    expect(prompt).toContain("内容锁定·强制");
    expect(prompt).toContain("插图简洁·强制");
    expect(prompt).toContain("16:9");
    expect(prompt).toContain("竞争格局对照");
    expect(prompt).toContain("付费转化");
    expect(prompt).toContain("LAYOUT ONLY");
    expect(prompt).not.toMatch(/阿里巴巴|Alibaba|Hermès|Tesla/i);
    expect(prompt).toContain("--ar 16:9");
  });

  it("aligns image prompt with selected deck style", () => {
    const prompt = buildHtmlPptSlideImagePrompt({
      templateId: "auto",
      styleId: "ivory_academic",
      page: hubPage,
    });
    expect(prompt).toContain("演示气质");
    expect(prompt).toContain("象牙学术");
  });

  it("uses explicit template id when valid", () => {
    const id = resolveHtmlPptImageTemplateId("infographic_rival_showdown", hubPage);
    expect(id).toBe("infographic_rival_showdown");
    const prompt = buildHtmlPptSlideImagePrompt({ templateId: id, page: hubPage });
    expect(prompt).toContain("左右对半对比");
  });
});
