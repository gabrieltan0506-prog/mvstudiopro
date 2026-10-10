import { expect, it } from "vitest";
import JSZip from "jszip";
import { buildVideoPptx } from "./htmlPptVideo";
it("视频字节嵌入PPTX并建立媒体关系，不使用远程链接", async () => {
  const bytes = Buffer.from("test-only-mp4-payload");
  const blob = await buildVideoPptx({ title: "测试", videoData: "data:video/mp4;base64," + bytes.toString("base64"), orientation: "landscape" });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const path = Object.keys(zip.files).find(name => name.startsWith("ppt/media/") && name.endsWith(".mp4"));
  expect(path).toBeTruthy();
  expect(await zip.file(path!)!.async("nodebuffer")).toEqual(bytes);
  const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
  expect(rels).toContain("/video"); expect(rels).not.toContain('TargetMode="External"');
});
it("缺失视频时拒绝导出空PPT", async () => { await expect(buildVideoPptx({ title: "测试", videoData: "https://example.com/temp.mp4", orientation: "portrait" })).rejects.toThrow("未取得"); });
