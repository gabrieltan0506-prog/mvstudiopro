import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildDefaultHtmlPptPages } from "./htmlPptMaker";
import { buildHtmlPptPptxBlob, listHtmlPptPptxImageUrls } from "./htmlPptPptx";

/** 1×1 PNG */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("buildHtmlPptPptxBlob", () => {
  it("exports an editable pptx blob from the same page list", async () => {
    const pages = buildDefaultHtmlPptPages("市场汇报", 10, "数据洞察", "ivory_academic").map(
      (p, i) =>
        i === 1
          ? {
              ...p,
              series: [
                { label: "关键爆品", value: 42 },
                { label: "市场规模", value: 168 },
              ],
            }
          : p,
    );
    const blob = await buildHtmlPptPptxBlob({
      title: "市场汇报",
      styleId: "ivory_academic",
      pages,
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(2000);
    expect(blob.type).toMatch(/presentation|zip|octet-stream|empty/);
  });

  it("embeds slide images and grows file size vs text-only", async () => {
    const imageUrl = "https://cdn.example.com/slide-hero.png";
    const pages = buildDefaultHtmlPptPages("插图导出", 10, "数据洞察", "rose_editorial").map(
      (p, i) => (i === 0 ? { ...p, imageUrl } : p),
    );
    const withImg = await buildHtmlPptPptxBlob(
      { title: "插图导出", styleId: "rose_editorial", pages },
      { imageDataByUrl: { [imageUrl]: TINY_PNG } },
    );
    const without = await buildHtmlPptPptxBlob({
      title: "插图导出",
      styleId: "rose_editorial",
      pages: pages.map(({ imageUrl: _u, ...rest }) => rest),
    });
    expect(withImg.size).toBeGreaterThan(without.size);
    expect(listHtmlPptPptxImageUrls({ title: "t", styleId: "rose_editorial", pages })).toEqual([
      imageUrl,
    ]);
  });

  it("fails when page has imageUrl but no image data", async () => {
    const pages = buildDefaultHtmlPptPages("缺图", 10, "数据洞察", "dark_research").map((p, i) =>
      i === 0 ? { ...p, imageUrl: "https://cdn.example.com/missing.png" } : p,
    );
    await expect(
      buildHtmlPptPptxBlob({ title: "缺图", styleId: "dark_research", pages }),
    ).rejects.toThrow(/未能载入图片/);
  });
});

it("导出原生可编辑图表，数值与原表一致", async () => {
  const blob = await buildHtmlPptPptxBlob({ title: "真实对比", styleId: "dark_research", pages: [{ title: "输入单价", viz: "bars", series: [{ label: "GLM", value: 0.37 }, { label: "DeepSeek", value: 0.3 }] }] });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const charts = Object.keys(zip.files).filter(name => /^ppt\/charts\/chart[0-9]+\.xml$/.test(name));
  expect(charts.length).toBe(1);
  const xml = await zip.file(charts[0])!.async("string");
  expect(xml).toContain("0.37"); expect(xml).toContain("0.3"); expect(xml).toContain("GLM");
  expect(Object.keys(zip.files).some(name => name.startsWith("ppt/embeddings/") && name.endsWith(".xlsx"))).toBe(true);
});

it("含图页数据超出排版容量时明确失败，不丢掉后面数据", async () => {
  const url = "https://cdn.example.com/test.png";
  await expect(buildHtmlPptPptxBlob({title:"原始数据",styleId:"dark_research",pages:[{title:"全部六项",imageUrl:url,series:Array.from({length:6},(_,i)=>({label:`数据${i+1}`,value:i+0.25}))}]},{imageDataByUrl:{[url]:TINY_PNG}})).rejects.toThrow("未截断导出");
});
