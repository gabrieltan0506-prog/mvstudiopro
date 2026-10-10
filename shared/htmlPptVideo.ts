import PptxGenJS from "pptxgenjs";

/** 把已经生成的视频嵌入文件，不创建新视频，也不保留临时签名地址。 */
export async function buildVideoPptx(input: { title: string; videoData: string; orientation: "landscape" | "portrait" }): Promise<Blob> {
  if (!/^data:video\/mp4;base64,[A-Za-z0-9+/]+=*$/.test(input.videoData)) throw new Error("未取得可嵌入的 MP4，原视频保留");
  const pptx = new PptxGenJS();
  const width = input.orientation === "portrait" ? 7.5 : 13.333;
  const height = input.orientation === "portrait" ? 13.333 : 7.5;
  pptx.defineLayout({ name: "YINGKE_VIDEO", width, height });
  pptx.layout = "YINGKE_VIDEO";
  pptx.title = input.title;
  const slide = pptx.addSlide();
  slide.background = { color: "111111" };
  slide.addMedia({ type: "video", data: input.videoData, extn: "mp4", x: 0, y: 0, w: width, h: height });
  slide.addNotes("本页嵌入映刻已生成的完整视频。播放方式由演示软件决定；视频内部元素不能在PPT中逐项编辑。需要修改文字或图表时请回原作品，或使用可编辑PPT模式。");
  return await pptx.write({ outputType: "blob" }) as Blob;
}
