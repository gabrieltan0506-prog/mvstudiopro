import sharp from "sharp";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type CoverFaceRegion = [number, number, number, number];
/** 和像素处理使用同一旋转方向；检测失败明确报错，不回退到全图肤色蒙版。 */
export async function detectCoverFaces(source: Buffer): Promise<CoverFaceRegion[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "cover-faces-"));
  try {
    const image = path.join(dir, "source.png");
    await writeFile(image, await sharp(source, { limitInputPixels: 20_000_000 }).rotate().png().toBuffer());
    const { stdout } = await promisify(execFile)("python3", [path.resolve("server/scripts/platform_cover_faces.py"), image], { timeout: 30_000, maxBuffer: 128 * 1024 });
    const result = JSON.parse(stdout);
    if (!Array.isArray(result.regions) || !result.regions.every((b: unknown) => Array.isArray(b) && b.length === 4 && b.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1))) throw new Error("人脸定位回执无效");
    return result.regions;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
import { createHash } from "node:crypto";
import type { CoverGradeStyle } from "../../shared/platformCoverCandidates.js";
import { downloadPhotoMedia } from "./photoMediaInput.js";
import { getGcsBucketName, uploadBufferToGcsIfAbsent, signGsUriV4ReadUrl } from "./gcs.js";
import { gsUriFromSignedGcsUrl } from "../../shared/manhuaMultiview.js";
import { registerCanvasMediaOwner } from "./canvasMediaOwnership.js";

const clamp = (n: number, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, n));
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** 独立像素后期：软肤色范围蒙版、低频局部明暗、分通道曲线；不重绘五官或文字。 */
export async function gradePlatformCover(source: Buffer, style: CoverGradeStyle, faces: CoverFaceRegion[] = []) {
  const { data, info } = await sharp(source, { limitInputPixels: 20_000_000 }).rotate().toColourspace("srgb").removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width < 64 || info.height < 64 || info.channels !== 3) throw new Error("封面原图尺寸或色彩格式无效");
  const pixels = info.width * info.height;
  const radius = Math.max(2, Math.min(info.width, info.height) / 55);
  const base = await sharp(data, { raw: info }).blur(radius).raw().toBuffer();
  const mask = Buffer.alloc(pixels);
  let skinWeight = 0;
  for (let p = 0; p < pixels; p++) {
    const i = p * 3, r = data[i], g = data[i + 1], b = data[i + 2];
    const cb = 128 - .168736 * r - .331264 * g + .5 * b;
    const cr = 128 + .5 * r - .418688 * g - .081312 * b;
    // 只在检测的人脸椭圆内校正，暖墙/木材不进入肤色处理；不宣称精细语义分割。
    const x = (p % info.width) / info.width, y = Math.floor(p / info.width) / info.height;
    const regionWeight = faces.reduce((weight, [fx, fy, fw, fh]) => {
      const d = ((x - fx - fw / 2) / (fw * .52)) ** 2 + ((y - fy - fh * .55) / (fh * .6)) ** 2;
      return Math.max(weight, clamp((1 - d) / .3, 0, 1));
    }, 0);
    const w = Math.exp(-(((cb - 108) / 15) ** 2 + ((cr - 151) / 18) ** 2) / 2)
      * clamp((r - b - 3) / 18, 0, 1) * clamp((r + g + b - 65) / 100, 0, 1);
    mask[p] = Math.round(w * regionWeight * 255);
    skinWeight += w * regionWeight;
  }
  const softMask = await sharp(mask, { raw: { width: info.width, height: info.height, channels: 1 } }).blur(2).greyscale().raw().toBuffer();
  const settings = style === "soft" ? { contrast: .07, shadow: 6, highlight: 8, warmth: 0 }
    : style === "cinematic" ? { contrast: .13, shadow: 3, highlight: 7, warmth: 2 }
      : { contrast: .09, shadow: 4, highlight: 6, warmth: 1 };
  const curves = [0, 1, 2].map(channel => Array.from({ length: 256 }, (_, n) => {
    const x = n / 255;
    const s = x + settings.contrast * (x - .5) * x * (1 - x);
    const tone = channel === 0 ? settings.warmth * x * (1 - x) : channel === 2 ? -settings.warmth * x * (1 - x) : 0;
    return clamp(s * 255 + tone);
  }));
  const output = Buffer.alloc(data.length);
  let changed = 0;
  for (let p = 0; p < pixels; p++) {
    const i = p * 3;
    const luminance = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
    const local = .2126 * base[i] + .7152 * base[i + 1] + .0722 * base[i + 2];
    // 保护高反差细节及黑白文字边缘；低频修饰不会模糊文字或皮肤纹理。
    const edgeProtection = 1 - clamp(Math.abs(luminance - local) / 38, 0, .95);
    const dodgeBurn = (settings.shadow * clamp((115 - local) / 115, 0, 1)
      - settings.highlight * clamp((local - 185) / 70, 0, 1)) * edgeProtection;
    const skin = softMask[p] / 255 * edgeProtection;
    const redExcess = Math.max(0, data[i] - data[i + 1] - 32);
    const yellowExcess = Math.max(0, (data[i] + data[i + 1]) / 2 - data[i + 2] - 40);
    for (let channel = 0; channel < 3; channel++) {
      const correction = channel === 0 ? -Math.min(6, redExcess * .12) : channel === 2 ? Math.min(5, yellowExcess * .1) : 0;
      output[i + channel] = Math.round(clamp(curves[channel][data[i + channel]] + dodgeBurn + correction * skin));
      if (output[i + channel] !== data[i + channel]) changed++;
    }
  }
  const image = await sharp(output, { raw: info }).png().toBuffer();
  const receipt = {
    version: "cover-grade-v2", style, width: info.width, height: info.height,
    sourceSha256: hash(source), outputSha256: hash(image),
    skinCorrection: { method: "face-region-soft-ycbcr-mask", faceRegions: faces, status: faces.length ? "applied" : "no-face-detected-skipped", coverage: skinWeight / pixels, semanticFaceDetection: false, maxRedCorrection: 6, maxBlueCorrection: 5 },
    localLight: { method: "low-frequency-dodge-burn", radius, edgeProtection: true, ...settings },
    toneCurve: { method: "rgb-256-entry-curves", curves },
    changedChannelFraction: changed / data.length,
    geometryChanged: false, textRedrawn: false,
  };
  return { image, receipt };
}

/** 只处理管线生成/数据库恢复的图片，不接收任意客户端地址。永久保存原图与回执。 */
export async function postProcessPlatformCover(url: string, userId: number, style: CoverGradeStyle, expectFace = false) {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("封面后期缺少用户归属");
  const durableUrl = url.startsWith("gs://") ? url : gsUriFromSignedGcsUrl(url);
  const source = await downloadPhotoMedia(durableUrl ? signGsUriV4ReadUrl(durableUrl) : url, 30 * 1024 * 1024);
  const faces = await detectCoverFaces(source);
  if (expectFace && !faces.length) throw new Error("未定位参考人物的人脸，原图保留，未标记调色完成");
  const { image, receipt } = await gradePlatformCover(source, style, faces);
  const prefix = `platform-cover-grade/u${userId}/${receipt.sourceSha256}/${receipt.version}-${style}`;
  const bucket = getGcsBucketName();
  const original = `${prefix}/original`;
  const output = `${prefix}/${receipt.outputSha256}.png`;
  const evidence = `${prefix}/receipt.json`;
  const format = (await sharp(source).metadata()).format;
  await uploadBufferToGcsIfAbsent({ objectName: original, buffer: source, contentType: format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png" });
  await uploadBufferToGcsIfAbsent({ objectName: output, buffer: image, contentType: "image/png" });
  await uploadBufferToGcsIfAbsent({ objectName: evidence, buffer: Buffer.from(JSON.stringify(receipt)), contentType: "application/json" });
  for (const objectPath of [original, output, evidence]) {
    const owner = await registerCanvasMediaOwner({ objectPath, ownerUserId: userId, source: "platform-cover-grade" });
    if (owner !== "created" && owner !== "alreadyOwned") throw new Error("封面后期产物归属登记失败，原图保留");
  }
  return { originalUrl: `gs://${bucket}/${original}`, imageUrl: `gs://${bucket}/${output}`, receiptUrl: `gs://${bucket}/${evidence}` };
}
