import { toPng } from "html-to-image";

function sanitizeFilenamePart(raw: string, max = 48): string {
  return String(raw || "")
    .replace(/[\\/:*?"<>|]/g, "·")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** 将 DOM 节点导出为 PNG 并触发浏览器下载 */
export async function downloadElementAsPng(
  el: HTMLElement,
  filenameBase: string,
  opts?: { backgroundColor?: string; pixelRatio?: number },
): Promise<void> {
  if (typeof document !== "undefined" && (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready) {
    await (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready;
  }
  await new Promise((r) => setTimeout(r, 200));
  const dataUrl = await toPng(el, {
    pixelRatio: opts?.pixelRatio ?? 2,
    backgroundColor: opts?.backgroundColor ?? "#0B0F19",
    cacheBust: true,
  });
  const link = document.createElement("a");
  const safe = sanitizeFilenamePart(filenameBase) || "mvstudiopro-export";
  link.download = `mvstudiopro-${safe}-${Date.now()}.png`;
  link.href = dataUrl;
  link.click();
}
