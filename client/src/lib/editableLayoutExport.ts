import {
  buildLayoutHtml,
  layoutImageSchema,
  type EditableLayout,
} from "@shared/editableLayout";
import { flyDownloadUrl } from "./gcsTransfer";

export function downloadLayoutBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]/g, "_");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export async function embedLayoutImages(
  doc: EditableLayout
): Promise<Record<string, string>> {
  const images: Record<string, string> = {};
  for (const url of Array.from(
    new Set(doc.pages.map(p => p.imageUrl).filter(Boolean))
  )) {
    layoutImageSchema.parse(url);
    const response = await fetch(flyDownloadUrl(url), {
      credentials: "include",
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(
        `配图下载失败（${response.status}），请重新选取可用图片；未导出缺图文件`
      );
    const blob = await response.blob();
    if (
      blob.size > 20 * 1024 * 1024 ||
      !/^image\/(png|jpeg|webp|gif)$/.test(blob.type)
    )
      throw new Error(
        "配图格式或大小不支持，请使用20MB以内的PNG/JPEG/WebP/GIF"
      );
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("图片读取失败"));
      r.readAsDataURL(blob);
    });
    // 实际解码，不能把200错误页或损坏文件当配图打包。
    const image = new Image();
    image.src = data;
    await image.decode();
    images[url] = data;
  }
  return images;
}
export async function exportEditableLayout(
  doc: EditableLayout,
  format: "html" | "png" | "pdf"
): Promise<Blob> {
  const images = await embedLayoutImages(doc);
  const html = buildLayoutHtml(doc, images);
  if (format === "html")
    return new Blob([html], { type: "text/html;charset=utf-8" });
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:800px;height:1000px;border:0";
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("排版加载超时")),
        30000
      );
      frame.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
    frame.srcdoc = html;
    document.body.append(frame);
    await loaded;
    const inside = frame.contentDocument!;
    await inside.fonts.ready;
    await Promise.all(Array.from(inside.images).map(image => image.decode()));
    const { toPng } = await import("html-to-image");
    const pages = Array.from(inside.querySelectorAll<HTMLElement>(".page"));
    const rendered: { data: string; height: number }[] = [];
    for (const page of pages) {
      if (page.scrollHeight > 12000)
        throw new Error(
          "单页内容过长，请拆成多页后导出图片或PDF；HTML保留全部内容"
        );
      const height = page.scrollHeight;
      rendered.push({
        data: await toPng(page, {
          width: 720,
          height,
          pixelRatio: 1.5,
          skipFonts: true,
          style: { margin: "0" },
        }),
        height,
      });
    }
    if (format === "png") {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      rendered.forEach((p, i) =>
        zip.file(
          `${String(i + 1).padStart(2, "0")}.png`,
          p.data.split(",")[1],
          { base64: true }
        )
      );
      zip.file("可编辑稿.html", html);
      return zip.generateAsync({ type: "blob" });
    }
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({
      unit: "pt",
      format: [720, rendered[0].height],
      orientation: rendered[0].height >= 720 ? "portrait" : "landscape",
    });
    rendered.forEach((p, i) => {
      if (i)
        pdf.addPage(
          [720, p.height],
          p.height >= 720 ? "portrait" : "landscape"
        );
      pdf.addImage(p.data, "PNG", 0, 0, 720, p.height);
    });
    return pdf.output("blob");
  } finally {
    frame.remove();
  }
}
