/**
 * 关键静帧 Image-2 edits 垫图：把人物库/参考图等比装进目标画幅（默认 9:16），
 * 避免直接文生漂移，也避免竖版输出被横版定妆图比例带歪。
 */
import sharp from "sharp";

export function parseOpenAiImageSize(size: string): { width: number; height: number } | null {
  const m = String(size || "")
    .trim()
    .match(/^(\d+)\s*[xX]\s*(\d+)$/);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 64 || height < 64) return null;
  return { width: Math.floor(width), height: Math.floor(height) };
}

/** 等比 contain 居中铺进目标画布（浅灰底），输出 PNG */
export async function padImageBufferToSize(buf: Buffer, size: string): Promise<Buffer> {
  const dim = parseOpenAiImageSize(size);
  if (!dim) return buf;
  const meta = await sharp(buf, { failOn: "none" }).metadata();
  const srcW = Number(meta.width || 0);
  const srcH = Number(meta.height || 0);
  if (srcW === dim.width && srcH === dim.height) {
    return sharp(buf, { failOn: "none" }).png().toBuffer();
  }
  return sharp(buf, { failOn: "none" })
    .resize(dim.width, dim.height, {
      fit: "contain",
      background: { r: 232, g: 232, b: 232, alpha: 1 },
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();
}
