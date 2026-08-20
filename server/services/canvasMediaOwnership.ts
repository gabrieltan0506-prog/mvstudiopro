/**
 * 画布生成媒体所有权(三审 P0-3):路由与 worker 共用同一把尺。
 * 归属判定 = 对象路径出现在**该用户本人**云端画布快照的资产字段里
 * (outputUrl/outputUrls/refImageUrl/editFusionUrls/editMaskUrl/lastFrameUrl),
 * prompt/outputText 等自由文本里出现的路径不构成所有权。
 * 60s 内存缓存;快照缺失/解析失败一律按空集拒绝。
 */
import { downloadGcsObject, getGcsBucketName } from "./gcs.js";

export const CANVAS_MEDIA_OBJECT_RE =
  /^generated\/[A-Za-z0-9_\/-]+\/[A-Za-z0-9_.-]+\.(png|jpg|jpeg|webp)$/;

const cache = new Map<number, { paths: Set<string>; ts: number }>();
const CACHE_TTL_MS = 60_000;

type DraftLoader = (userId: number) => Promise<string | null>;

async function defaultLoader(userId: number): Promise<string | null> {
  try {
    const { buffer } = await downloadGcsObject({
      gcsUri: `gs://${getGcsBucketName()}/manhua-cloud-drafts/user-${userId}.json`,
    });
    return buffer.toString("utf8");
  } catch {
    return null;
  }
}

function collectFrom(u: unknown, paths: Set<string>): void {
  const m = String(u || "").match(
    /(?:^|\/api\/canvas-media\/|storage\.googleapis\.com\/[^/]+\/)(generated\/[A-Za-z0-9_\/-]+\/[A-Za-z0-9_.%-]+\.(?:png|jpe?g|webp))/i,
  );
  if (!m) return;
  try {
    paths.add(decodeURIComponent(m[1]));
  } catch {
    /* 非法编码不入集 */
  }
}

/** 从用户云快照的资产字段收集其名下 generated/ 对象路径 */
export async function collectUserCanvasMediaPaths(
  userId: number,
  opts?: { loader?: DraftLoader; skipCache?: boolean },
): Promise<Set<string>> {
  const now = Date.now();
  if (!opts?.skipCache) {
    const hit = cache.get(userId);
    if (hit && now - hit.ts <= CACHE_TTL_MS) return hit.paths;
  }
  const paths = new Set<string>();
  const raw = await (opts?.loader || defaultLoader)(userId);
  if (raw) {
    try {
      const wrapper = JSON.parse(raw) as { payloadJson?: string; payload?: unknown };
      const payloadRaw =
        typeof wrapper.payloadJson === "string" ? JSON.parse(wrapper.payloadJson) : wrapper.payload ?? wrapper;
      const blocks = (payloadRaw as { canvas?: { blocks?: unknown[] } })?.canvas?.blocks || [];
      for (const blk of blocks as Array<Record<string, unknown>>) {
        collectFrom(blk.outputUrl, paths);
        collectFrom(blk.refImageUrl, paths);
        collectFrom(blk.editMaskUrl, paths);
        collectFrom(blk.lastFrameUrl, paths);
        for (const u of Array.isArray(blk.outputUrls) ? blk.outputUrls : []) collectFrom(u, paths);
        for (const u of Array.isArray(blk.editFusionUrls) ? blk.editFusionUrls : []) collectFrom(u, paths);
      }
    } catch {
      /* 解析失败 = 空集,一律拒绝;不回退全文匹配 */
    }
  }
  cache.set(userId, { paths, ts: now });
  return paths;
}

/**
 * 校验对象归属:路径不合法/穿越/未登记在该用户资产字段 → false。
 * worker 给受保护媒体签名前必须先过这里(三审 P0-3:防跨用户签名绕过)。
 */
export async function verifyCanvasMediaOwnership(
  userId: number,
  objectPath: string,
  opts?: { loader?: DraftLoader; skipCache?: boolean },
): Promise<boolean> {
  const p = String(objectPath || "");
  if (!CANVAS_MEDIA_OBJECT_RE.test(p) || p.includes("..")) return false;
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return false;
  const paths = await collectUserCanvasMediaPaths(uid, opts);
  return paths.has(p);
}

/** 仅测试用:清缓存 */
export function __resetCanvasMediaOwnershipCacheForTests(): void {
  cache.clear();
}
