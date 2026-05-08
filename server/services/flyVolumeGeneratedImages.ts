import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_DIR = "/data/growth/platform-generated-images";

export function getFlyPlatformImageBaseDir(): string {
  const raw = String(process.env.FLY_PLATFORM_IMAGE_DIR || "").trim();
  return path.resolve(raw || DEFAULT_DIR);
}

/** 與 GCS subdir 對齊的目錄名淨化（僅允許安全字元）。 */
export function sanitizeFlyImageSubdir(raw: string): string {
  const out = String(raw || "misc")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80)
    .replace(/^\.+/, "")
    .trim();
  return out || "misc";
}

export type FlyVolumeImageWriteResult = { relPath: string };

export async function writeFlyPlatformImageBuffer(params: {
  subdir: string;
  buffer: Buffer;
  contentType: "image/jpeg" | "image/png" | "image/webp";
}): Promise<FlyVolumeImageWriteResult> {
  const base = getFlyPlatformImageBaseDir();
  const safeSub = sanitizeFlyImageSubdir(params.subdir);
  const ext =
    params.contentType === "image/jpeg" ? "jpg" : params.contentType === "image/webp" ? "webp" : "png";
  const fileName = `${Date.now()}_${randomUUID().slice(0, 8)}.${ext}`;
  const dirAbs = path.join(base, safeSub);
  await fs.mkdir(dirAbs, { recursive: true });
  const fileAbs = path.join(dirAbs, fileName);
  await fs.writeFile(fileAbs, params.buffer);
  const relPath = path.join(safeSub, fileName).replace(/\\/g, "/");
  return { relPath };
}

/** 與 {@link buildBlobMediaUrlFromPath} 類似：公開讀取走 Fly（或經 Vercel rewrite 到 Fly）的 /api/jobs。 */
export function buildFlyPlatformImagePublicUrl(relPath: string): string {
  const root = String(process.env.OAUTH_SERVER_URL || "").trim().replace(/\/+$/, "") || "https://mvstudiopro.fly.dev";
  const rel = String(relPath || "").replace(/^\/+/, "");
  return `${root}/api/jobs?op=flyVolumeMedia&relPath=${encodeURIComponent(rel)}`;
}

export type FlySafePathResult = { ok: true; abs: string } | { ok: false; reason: string };

/** GET 讀檔前：防路徑穿越，限制在持久卷基目錄內。 */
export function resolveSafeFlyPlatformImageReadPath(relPath: string): FlySafePathResult {
  const rel = String(relPath || "").trim().replace(/^\/+/, "");
  if (!rel) return { ok: false, reason: "empty" };
  if (rel.includes("..") || path.isAbsolute(rel)) return { ok: false, reason: "invalid" };
  const BASE = getFlyPlatformImageBaseDir();
  const abs = path.resolve(BASE, rel);
  const baseWithSep = BASE.endsWith(path.sep) ? BASE : `${BASE}${path.sep}`;
  if (!abs.startsWith(baseWithSep) && abs !== BASE) {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, abs };
}
