/**
 * Fly 编辑桥（PR-9）：中国用户读不到 GCS，所以「能看 / 能改 / 能渲」的资产先落 Fly 持久卷，
 * 归档才上 GCS（GCS→Fly→用户→Fly→GCS）。本文件只管卷上的工作副本：
 *   - 写入：writeBridgeFile / writeBridgeFileFromUrl
 *   - 读取：resolveSafeBridgeReadPath（防穿越）+ bridgeMimeFor（按后缀）
 *   - 拉取：ensureBridgeCopyFromGcs（卷上没有就从 GCS 拉一份）
 *   - 归档：archiveBridgeFileToGcs（Fly → GCS）
 * 公开读取走 /api/jobs?op=manhuaBridgeMedia&relPath=…（Vercel rewrite 到 Fly）。
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { downloadGcsObject, uploadBufferToGcs } from "./gcs.js";

const DEFAULT_DIR = "/data/growth/manhua-bridge";

export function getBridgeBaseDir(): string {
  const raw = String(process.env.MANHUA_BRIDGE_DIR || "").trim();
  return path.resolve(raw || DEFAULT_DIR);
}

/** 目录/文件名净化：只允许安全字符，防穿越 */
export function sanitizeBridgePart(raw: string, fallback = "misc"): string {
  const out = String(raw || "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return out || fallback;
}

export type BridgeRef = { ns: string; id: string; name: string };

export function bridgeRelPath(ref: BridgeRef): string {
  return [sanitizeBridgePart(ref.ns), sanitizeBridgePart(ref.id, "item"), sanitizeBridgePart(ref.name, "file")].join("/");
}

export type BridgeSafePath = { ok: true; abs: string; relPath: string } | { ok: false; reason: string };

export function resolveSafeBridgeReadPath(relPathRaw: string): BridgeSafePath {
  const rel = String(relPathRaw || "").trim().replace(/^\/+/, "");
  if (!rel) return { ok: false, reason: "empty" };
  if (rel.includes("..") || rel.includes("\\") || path.isAbsolute(rel)) return { ok: false, reason: "invalid" };
  if (rel.split("/").length !== 3) return { ok: false, reason: "shape" };
  const base = getBridgeBaseDir();
  const abs = path.resolve(base, rel);
  const baseWithSep = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  if (!abs.startsWith(baseWithSep)) return { ok: false, reason: "forbidden" };
  return { ok: true, abs, relPath: rel };
}

const MIME_BY_EXT: Record<string, string> = {
  ".spz": "application/octet-stream",
  ".ply": "application/octet-stream",
  ".splat": "application/octet-stream",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
};

export function bridgeMimeFor(fileName: string): string {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

/** 稳定公开地址（走 Fly；中国可达），不带签名不过期 */
export function buildBridgeMediaUrl(relPath: string): string {
  const root = String(process.env.OAUTH_SERVER_URL || "").trim().replace(/\/+$/, "") || "https://mvstudiopro.com";
  return `${root}/api/jobs?op=manhuaBridgeMedia&relPath=${encodeURIComponent(String(relPath || "").replace(/^\/+/, ""))}`;
}

export async function writeBridgeFile(ref: BridgeRef, buffer: Buffer): Promise<{ relPath: string; abs: string; bytes: number; sha256: string }> {
  const relPath = bridgeRelPath(ref);
  const abs = path.join(getBridgeBaseDir(), relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const temporary = `${abs}.tmp.${process.pid}.${randomUUID()}`; // 1472 R1：同毫秒并发写同一文件不再撞临时名
  await fs.writeFile(temporary, buffer);
  await fs.rename(temporary, abs);
  return { relPath, abs, bytes: buffer.byteLength, sha256: createHash("sha256").update(buffer).digest("hex") };
}

export async function bridgeFileExists(relPath: string): Promise<boolean> {
  const safe = resolveSafeBridgeReadPath(relPath);
  if (!safe.ok) return false;
  try {
    const st = await fs.stat(safe.abs);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

export type BridgeFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/** 从上游 URL 拉到卷上（限大小），返回工作副本相对路径 */
export async function writeBridgeFileFromUrl(
  ref: BridgeRef,
  url: string,
  opts?: { maxBytes?: number; timeoutMs?: number; fetchImpl?: BridgeFetch },
): Promise<{ relPath: string; bytes: number; sha256: string }> {
  const maxBytes = Math.max(1, opts?.maxBytes ?? 512 * 1024 * 1024);
  const fetchImpl = opts?.fetchImpl ?? ((u, init) => fetch(u, init));
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(opts?.timeoutMs ?? 300_000) });
  if (!response.ok) throw new Error(`bridge_fetch_http_${response.status}`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("bridge_file_too_large");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.byteLength) throw new Error("bridge_file_empty");
  if (buffer.byteLength > maxBytes) throw new Error("bridge_file_too_large");
  const written = await writeBridgeFile(ref, buffer);
  return { relPath: written.relPath, bytes: written.bytes, sha256: written.sha256 };
}

/** 卷上没有就从 GCS 拉一份工作副本（GCS→Fly）；有就直接用 */
export async function ensureBridgeCopyFromGcs(
  ref: BridgeRef,
  gcsUri: string,
  deps?: { download?: (gcsUri: string) => Promise<Buffer> },
): Promise<{ relPath: string; fromCache: boolean }> {
  const relPath = bridgeRelPath(ref);
  if (await bridgeFileExists(relPath)) return { relPath, fromCache: true };
  const download = deps?.download ?? (async (uri: string) => (await downloadGcsObject({ gcsUri: uri })).buffer);
  const buffer = await download(gcsUri);
  await writeBridgeFile(ref, buffer);
  return { relPath, fromCache: false };
}

/** 工作副本归档到 GCS（Fly→GCS）；返回 gs:// */
export async function archiveBridgeFileToGcs(
  relPath: string,
  objectName: string,
  deps?: { upload?: typeof uploadBufferToGcs },
): Promise<{ gcsUri: string; bytes: number }> {
  const safe = resolveSafeBridgeReadPath(relPath);
  if (!safe.ok) throw new Error(`bridge_invalid_rel_path:${safe.reason}`);
  const buffer = await fs.readFile(safe.abs);
  if (!buffer.byteLength) throw new Error("bridge_file_empty");
  const upload = deps?.upload ?? uploadBufferToGcs;
  const uploaded = await upload({ objectName, buffer, contentType: bridgeMimeFor(safe.abs) });
  return { gcsUri: uploaded.gcsUri, bytes: buffer.byteLength };
}
