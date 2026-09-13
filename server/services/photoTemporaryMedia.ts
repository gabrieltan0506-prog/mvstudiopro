import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { downloadPhotoMedia } from "./photoMediaInput.js";

export const PHOTO_TEMP_TTL_MS = 12 * 3600_000;
export const PHOTO_TEMP_MAX_BYTES = 512 * 1024 * 1024;
export function photoTempDir() {
  return path.resolve(
    process.env.PHOTO_TEMP_MEDIA_DIR || "/data/growth/photo-temporary-media"
  );
}
const NAME =
  /^(\d{13})_[0-9a-f-]{36}\.(png|jpg|webp|mp4|mov|webm|m4v|pdf|upload)$/;
export function photoTempExpires(name: string) {
  const match = NAME.exec(name);
  return match ? Number(match[1]) + PHOTO_TEMP_TTL_MS : 0;
}
export function photoTempName(ext: string) {
  return `${Date.now()}_${randomUUID()}.${ext}`;
}
export function photoTempUrl(name: string) {
  if (!NAME.test(name)) throw new Error("临时媒体路径无效");
  const base = (
    process.env.PHOTO_TEMP_PUBLIC_ORIGIN || "https://api.mvstudiopro.com"
  ).replace(/\/+$/, "");
  return `${base}/api/photo-media/${name}`;
}
export async function ensurePhotoTempSpace() {
  await fs.mkdir(photoTempDir(), { recursive: true });
  const disk = await fs.statfs(photoTempDir());
  if (disk.bavail * disk.bsize < PHOTO_TEMP_MAX_BYTES + 256 * 1024 * 1024)
    throw new Error("临时下载空间繁忙，请稍后再试");
}
export async function cleanupPhotoTemp(now = Date.now()) {
  await fs.mkdir(photoTempDir(), { recursive: true });
  for (const name of await fs.readdir(photoTempDir())) {
    const expires = photoTempExpires(name);
    if (expires && expires <= now)
      await fs.unlink(path.join(photoTempDir(), name)).catch(e => {
        if (e.code !== "ENOENT") throw e;
      });
  }
}
export function schedulePhotoTempRemoval(name: string) {
  const delay = Math.max(0, photoTempExpires(name) - Date.now());
  const timer = setTimeout(
    () =>
      void fs.unlink(path.join(photoTempDir(), name)).catch(e => {
        if (e.code !== "ENOENT")
          console.error("[photoTemp] 删除到期媒体失败", e.code);
      }),
    delay
  );
  timer.unref();
}
export async function mirrorPhotoTemp(
  url: string,
  kind: "image" | "video" | "pdf"
) {
  const source = new URL(url);
  const own = new URL(photoTempUrl(photoTempName("mp4")));
  if (
    source.origin === own.origin &&
    source.pathname.startsWith("/api/photo-media/")
  ) {
    const name = source.pathname.split("/").pop() || "";
    if (photoTempExpires(name) <= Date.now())
      throw new Error("临时文件已到期，请重新上传");
    await fs.access(path.join(photoTempDir(), name));
    return { url, expiresAt: new Date(photoTempExpires(name)).toISOString() };
  }
  await ensurePhotoTempSpace();
  const pendingName = photoTempName("upload");
  const pendingPath = path.join(photoTempDir(), pendingName);
  try {
    const disk = await fs.statfs(photoTempDir());
    const available = Math.max(0, disk.bavail * disk.bsize - 256 * 1024 * 1024);
    await downloadPhotoMedia(
      url,
      kind === "pdf" ? available : PHOTO_TEMP_MAX_BYTES,
      pendingPath
    );
    let ext = "mp4";
    if (kind === "image") {
      const sharp = (await import("sharp")).default;
      const meta = await sharp(pendingPath, {
        limitInputPixels: false,
      }).metadata();
      if (!["png", "jpeg", "webp"].includes(meta.format || ""))
        throw new Error("图片内容无效");
      ext = meta.format === "jpeg" ? "jpg" : meta.format!;
    } else {
      const file = await fs.open(pendingPath, "r");
      const head = Buffer.alloc(64);
      try {
        await file.read(head, 0, 64, 0);
      } finally {
        await file.close();
      }
      if (kind === "pdf") {
        if (!head.subarray(0, 5).equals(Buffer.from("%PDF-")))
          throw new Error("PDF内容无效");
        ext = "pdf";
      } else if (!head.includes(Buffer.from("ftyp")))
        throw new Error("视频内容无效");
    }
    const name = pendingName.replace(/upload$/, ext);
    await fs.rename(pendingPath, path.join(photoTempDir(), name));
    schedulePhotoTempRemoval(name);
    return {
      url: photoTempUrl(name),
      expiresAt: new Date(photoTempExpires(name)).toISOString(),
    };
  } finally {
    await fs.unlink(pendingPath).catch(() => {});
  }
}
