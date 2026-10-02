import sharp from "sharp";
import { createHash } from "node:crypto";
import { downloadPhotoMedia } from "./photoMediaInput.js";
import { getGcsBucketName, uploadBufferToGcsIfAbsent, signGcsObjectPathV4ReadUrl } from "./gcs.js";
import { registerCanvasMediaOwner } from "./canvasMediaOwnership.js";

/** 仅接收已完成归属校验和现签的图片；不处理白模视频，不调用付费模型。 */
export async function normalizeSeedanceReferenceImage(url: string, userId: number): Promise<string> {
  const source = await downloadPhotoMedia(url, 20 * 1024 * 1024);
  const image = sharp(source, { limitInputPixels: 40_000_000 });
  const { width, height, orientation } = await image.metadata();
  if (!width || !height) throw new Error("参考图片尺寸无法读取，本次未提交供应商");
  const rotated = orientation && orientation >= 5;
  const w = rotated ? height : width, h = rotated ? width : height;
  if (w >= 300 && h >= 300) return url;
  const factor = Math.ceil(Math.max(300 / w, 300 / h));
  const buffer = await image.rotate().resize(w * factor, h * factor).png().toBuffer();
  const output = await sharp(buffer).metadata();
  if (!output.width || !output.height || output.width < 300 || output.height < 300) {
    throw new Error("参考图片自动放大未达到尺寸要求，本次未提交供应商");
  }
  // 内容寻址＋用户隔离，fallback和恢复可复用，不覆盖原图。
  const hash = createHash("sha256").update(buffer).digest("hex");
  const objectPath = `generated/seedance-reference-size/u${userId}/${hash}.png`;
  await uploadBufferToGcsIfAbsent({ objectName: objectPath, buffer, contentType: "image/png" });
  const owner = await registerCanvasMediaOwner({ objectPath, ownerUserId: userId, source: "seedance-reference-size" });
  if (owner !== "created" && owner !== "alreadyOwned") throw new Error("参考图片放大产物归属登记失败，本次未提交供应商");
  return signGcsObjectPathV4ReadUrl(getGcsBucketName(), objectPath);
}
