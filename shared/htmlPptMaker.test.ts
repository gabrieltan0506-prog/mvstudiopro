import { describe, expect, it } from "vitest";
import {
  buildDefaultHtmlPptPages,
  buildHtmlPptDocument,
  normalizeHtmlPptPages,
  scrubVisibleThemeIdLeaks,
} from "./htmlPptMaker";

describe("scrubVisibleThemeIdLeaks", () => {
  it("strips bracketed and bare themeIds from visible copy", () => {
    const raw =
      "七项议程 | [u_1_oaic]关键爆品 | [growth_forecast]增长预测与空间 | content_supply 内容供给";
    const cleaned = scrubVisibleThemeIdLeaks(raw, [
      "u_1_oaic",
      "growth_forecast",
      "content_supply",
    ]);
    expect(cleaned).not.toMatch(/u_1_oaic|growth_forecast|content_supply|\[/);
    expect(cleaned).toContain("关键爆品");
    expect(cleaned).toContain("增长预测");
    expect(cleaned).toContain("内容供给");
  });
});

describe("normalizeHtmlPptPages", () => {
  it("scrubs themeId leaks from titles and series labels", () => {
    const [page] = normalizeHtmlPptPages([
      {
        title: "[u_1_oaic]关键爆品",
        themeId: "u_1_oaic",
        subtitle: "growth_forecast 增长预测与空间",
        series: [
          { label: "[content_supply]内容供给", value: 12 },
          { label: "平台格局", value: 8 },
        ],
      },
    ]);
    expect(page?.title).toBe("关键爆品");
    expect(page?.subtitle).toBe("增长预测与空间");
    expect(page?.series?.[0]?.label).toBe("内容供给");
    expect(page?.themeId).toBe("u_1_oaic");
  });
});

describe("buildHtmlPptDocument quality gates", () => {
  it("does not show style labelZh in slide chrome; controls sit top-right", () => {
    const pages = buildDefaultHtmlPptPages("象牙测试", 10, "学术汇报", "ivory_academic");
    const html = buildHtmlPptDocument({
      title: "象牙测试",
      styleId: "ivory_academic",
      pages,
    });
    expect(html).not.toContain("象牙学术");
    expect(html).not.toContain("黑橙路演");
    expect(html).toContain("controls{position:fixed;top:12px;right:12px");
    expect(html).toContain("orientation: portrait");
    expect(html).toContain("竖屏阅读模式");
    expect(html).toContain("hub-grid");
    expect(html).toContain("color:var(--accent");
  });

  it("treats slide image as a build component: hero then dock", () => {
    const pages = buildDefaultHtmlPptPages("插图动效", 10, "数据洞察", "rose_editorial").map(
      (p, i) =>
        i === 0
          ? { ...p, imageUrl: "https://cdn.example.com/slide-hero.png" }
          : p,
    );
    const html = buildHtmlPptDocument({
      title: "插图动效",
      styleId: "rose_editorial",
      pages,
    });
    expect(html).toContain('data-img-dock="1"');
    expect(html).toContain('data-role="slide-image"');
    expect(html).toContain("syncImageDock");
    expect(html).toContain("img-docked");
    expect(html).toContain("slide-has-image:not(.img-docked)");
  });
});
