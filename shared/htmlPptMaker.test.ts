import { describe, expect, it } from "vitest";
import {
  buildDefaultHtmlPptPages,
  buildHtmlPptDocument,
  DEFAULT_HTML_PPT_IMAGE_MOTION,
  normalizeHtmlPptImageMotion,
  normalizeHtmlPptPages,
  resolveHtmlPptImageMotion,
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

  it("scrubs other pages' themeIds using deck-wide known ids", () => {
    const pages = normalizeHtmlPptPages([
      {
        title: "目录",
        themeId: "agenda",
        bullets: ["growth_forecast 增长", "content_supply 供给"],
      },
      {
        title: "市场规模",
        themeId: "growth_forecast",
        subtitle: "content_supply 不应泄漏",
      },
    ]);
    expect(pages[0]?.bullets?.join(" ")).not.toMatch(/growth_forecast|content_supply/);
    expect(pages[0]?.bullets?.join(" ")).toContain("增长");
    expect(pages[1]?.subtitle).toBe("不应泄漏");
  });

  it("fills default imageMotion when page has imageUrl", () => {
    const [page] = normalizeHtmlPptPages([
      {
        title: "有图页",
        imageUrl: "https://cdn.example.com/a.png",
      },
    ]);
    expect(page?.imageMotion).toEqual(DEFAULT_HTML_PPT_IMAGE_MOTION);
  });

  it("keeps custom imageMotion without imageUrl for later attach", () => {
    const [page] = normalizeHtmlPptPages([
      {
        title: "预编排",
        imageMotion: [
          { at: 0, pose: "hero" },
          { at: 1, pose: "dock_right" },
          { at: 3, pose: "hero" },
          { at: 4, pose: "dock_left" },
        ],
      },
    ]);
    expect(page?.imageMotion).toEqual([
      { at: 0, pose: "hero" },
      { at: 1, pose: "dock_right" },
      { at: 3, pose: "hero" },
      { at: 4, pose: "dock_left" },
    ]);
  });

  it("drops illegal imageMotion and falls back when has image", () => {
    const [page] = normalizeHtmlPptPages([
      {
        title: "坏关键帧",
        imageUrl: "https://cdn.example.com/b.png",
        imageMotion: [{ at: 2, pose: "zoom" as "hero" }],
      },
    ]);
    expect(page?.imageMotion).toEqual(DEFAULT_HTML_PPT_IMAGE_MOTION);
  });
});

describe("normalizeHtmlPptImageMotion", () => {
  it("prepends hero@0 and clamps length", () => {
    const frames = normalizeHtmlPptImageMotion([
      { at: 2, pose: "dock_left" },
      { at: 1, pose: "dock_right" },
      { at: 3, pose: "hero" },
      { at: 4, pose: "dock_bottom" },
      { at: 5, pose: "dock_right" },
      { at: 6, pose: "hero" },
    ]);
    expect(frames?.[0]).toEqual({ at: 0, pose: "hero" });
    expect(frames).toHaveLength(5);
  });

  it("returns undefined for all-illegal poses", () => {
    expect(normalizeHtmlPptImageMotion([{ at: 0, pose: "fly" }])).toBeUndefined();
  });
});

describe("resolveHtmlPptImageMotion", () => {
  it("returns undefined without imageUrl", () => {
    expect(
      resolveHtmlPptImageMotion({
        imageMotion: DEFAULT_HTML_PPT_IMAGE_MOTION,
      }),
    ).toBeUndefined();
  });
});

describe("buildHtmlPptDocument quality gates", () => {
  it("uses per-page gradient ids and does not force % on absolute ring kpi", () => {
    const pages = buildDefaultHtmlPptPages("环形指标", 10, "数据洞察", "dark_research").map((p, i) =>
      i === 2
        ? {
            ...p,
            title: "渗透",
            viz: "ring" as const,
            kpi: "168亿",
            series: [
              { label: "渗透", value: 35 },
              { label: "对照", value: 20 },
            ],
          }
        : p,
    );
    const html = buildHtmlPptDocument({
      title: "环形指标",
      styleId: "dark_research",
      pages,
    });
    expect(html).not.toContain('id="rg-2"');
    expect(html).toContain("viz-table");
    expect(html).toContain("168亿");
    expect(html).not.toMatch(/data-to="168"[^>]*data-suffix="%"/);
  });

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

  it("emits default imageMotion keyframes and pose sync", () => {
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
    expect(html).toContain("data-img-motion=");
    expect(html).toContain("dock_right");
    expect(html).toContain('data-role="slide-image"');
    expect(html).toContain("syncImagePose");
    expect(html).toContain("img-pose-hero");
    expect(html).toContain("img-pose-dock_right");
  });

  it("emits custom keyframes including dock_left and re-hero", () => {
    const pages = buildDefaultHtmlPptPages("自定义关键帧", 10, "数据洞察", "rose_editorial").map(
      (p, i) =>
        i === 0
          ? {
              ...p,
              imageUrl: "https://cdn.example.com/custom.png",
              imageMotion: [
                { at: 0, pose: "hero" as const },
                { at: 1, pose: "dock_right" as const },
                { at: 3, pose: "hero" as const },
                { at: 4, pose: "dock_left" as const },
              ],
            }
          : p,
    );
    const html = buildHtmlPptDocument({
      title: "自定义关键帧",
      styleId: "rose_editorial",
      pages,
    });
    expect(html).toContain("dock_left");
    expect(html).toContain("img-pose-dock_left");
    expect(html).toContain("&quot;at&quot;:3");
  });
});

it("缺失图表数据不补造，明确提示；空数值不变成0", () => {
  const html = buildHtmlPptDocument({ title: "数据核对", styleId: "dark_research", pages: [{ title: "分类比较", viz: "bars", bullets: ["项目一", "项目二", "项目三"] }] });
  expect(html).toContain("尚未提供这张图的数值");
  expect(() => normalizeHtmlPptPages([{ title: "缺失", series: [{ label: "项目", value: null as unknown as number }] }])).toThrow("缺失");
  expect(normalizeHtmlPptPages([{ title: "大数", series: [{ label: "金额", value: 987654321.25 }] }])[0].series![0].value).toBe(987654321.25);
});


describe("真实数值导出", () => {
  it("保留小数原精度，空页面不补样例", () => {
    const html = buildHtmlPptDocument({ title: "价格", styleId: "dark_research", pages: [{ title: "价格", viz: "bars", series: [{label: "输入", value: 0.37}, {label: "输出", value: 1.25}] }] });
    expect(html).toContain('data-display="0.37"');
    expect(html).toContain('data-display="1.25"');
    expect(() => buildHtmlPptDocument({ title: "空稿", styleId: "dark_research", pages: [] })).toThrow("请先添加页面");
  });
});
