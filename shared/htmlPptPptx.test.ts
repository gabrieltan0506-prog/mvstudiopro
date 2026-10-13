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

it("已有动效MP4嵌入目标页且正文仍为可编辑文字", async () => {
  const videoUrl = "https://test.invalid/existing.mp4";
  const data = "data:video/mp4;base64,AAAAFGZ0eXBpc29tAAAAAGlzb20=";
  const pages = [{ title: "保留可编辑标题", bullets: ["现有成片，不重新生成"], videoUrl, videoSource: { projectId: "test-project", jobId: "test-job" } }];
  const blob = await buildHtmlPptPptxBlob({ title: "已有动效", styleId: "dark_research", pages }, { videoDataByUrl: { [videoUrl]: data } });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const mp4 = Object.keys(zip.files).find(name => /^ppt\/media\/.*\.mp4$/.test(name));
  expect(mp4).toBeTruthy();
  expect(await zip.file(mp4!)!.async("base64")).toBe(data.split(",")[1]);
  const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(slide).toContain("videoFile"); expect(slide).toContain("保留可编辑标题");
});
it("缺少原视频时阻止导出，不静默丢掉动效", async () => {
  await expect(buildHtmlPptPptxBlob({ title: "缺视频", styleId: "dark_research", pages: [{ title: "原页", videoUrl: "https://test.invalid/missing.mp4", videoSource: { projectId: "test", jobId: "test-job" } }] })).rejects.toThrow(/视频/);
});

it("HTML内嵌MP4可离线保留，视频操作不触发翻页，离页暂停", async () => {
  const { buildHtmlPptDocument, normalizeHtmlPptPages } = await import("./htmlPptMaker");
  const videoUrl = "data:video/mp4;base64,AAAAFGZ0eXBpc29tAAAAAGlzb20=";
  const pages = [{ title: "已有视频", videoSource: { projectId: "test", jobId: "test-job" }, videoUrl }];
  expect(normalizeHtmlPptPages(pages)[0].videoUrl).toBe(videoUrl);
  const html = buildHtmlPptDocument({ title: "离线演示", styleId: "dark_research", pages });
  expect(html).toContain(`src="${videoUrl}"`);
  expect(html).toContain("closest('#controls,video')");
  expect(html).toContain("v.pause()");
  expect(html).toContain("slide-has-image img-pose-dock_right");
  expect(html).toContain("aspect-ratio:16/9");
  expect(html).toContain("if(slide.querySelector('video')) return;");
  expect(normalizeHtmlPptPages([{ ...pages[0], videoUrl: "javascript:alert(1)" }])[0].videoUrl).toBeUndefined();
});
