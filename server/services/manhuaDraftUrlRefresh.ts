/**
 * 云草稿签名链接自愈（0902 事故根治）。
 *
 * 事故：云草稿快照里的图片/音频存的是 V4 签名下载链接（最长 7 天），信封本身
 * 留 30 天——超过一周再回填，节点都在、图全裂，用户以为"备份只有六天"。
 * 根治：服务端返回草稿前深走 JSON，把本桶的签名链接全部按对象路径重签
 * （本地 HMAC，零网络零成本）。对象已被删的重签后仍 404，与原状一致不装好。
 */
import { getGcsBucketName, signGsUriV4ReadUrl } from "./gcs.js";

const SIGNED_URL_TTL_SECONDS = 7 * 24 * 3600;

export type ManhuaDraftUrlRefreshStats = { scanned: number; refreshed: number };

function tryRefreshOne(
  value: string,
  bucketName: string,
  sign: (gcsUri: string, ttlSeconds: number) => string
): string | null {
  if (!value.startsWith("https://storage.googleapis.com/")) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  // 只动带 V4 签名的链接；公共 URL / 其他签名版本不碰
  if (!parsed.searchParams.get("X-Goog-Signature")) return null;
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const bucket = segments[0];
  if (bucket !== bucketName) return null;
  let objectName: string;
  try {
    objectName = segments.slice(1).map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
  if (!objectName || objectName.includes("..")) return null;
  try {
    return sign(`gs://${bucket}/${objectName}`, SIGNED_URL_TTL_SECONDS);
  } catch {
    // 单条签失败保留原值，不让一条坏链拖垮整包回填
    return null;
  }
}

function walk(
  node: unknown,
  bucketName: string,
  sign: (gcsUri: string, ttlSeconds: number) => string,
  stats: ManhuaDraftUrlRefreshStats
): unknown {
  if (typeof node === "string") {
    stats.scanned += 1;
    const refreshed = tryRefreshOne(node, bucketName, sign);
    if (refreshed && refreshed !== node) {
      stats.refreshed += 1;
      return refreshed;
    }
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((item) => walk(item, bucketName, sign, stats));
  }
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = walk(value, bucketName, sign, stats);
    }
    return out;
  }
  return node;
}

/**
 * 深拷贝并重签草稿里本桶的全部 V4 签名链接。纯本地运算；异常时原样返回，
 * 自愈失败绝不能挡住回填本身。
 */
export function refreshManhuaDraftSignedUrls<T>(
  payload: T,
  deps: {
    bucketName?: string;
    sign?: (gcsUri: string, ttlSeconds: number) => string;
  } = {}
): { payload: T; stats: ManhuaDraftUrlRefreshStats } {
  const stats: ManhuaDraftUrlRefreshStats = { scanned: 0, refreshed: 0 };
  try {
    const bucketName = String(deps.bucketName || getGcsBucketName()).trim();
    const sign = deps.sign || signGsUriV4ReadUrl;
    if (!bucketName) return { payload, stats };
    const refreshed = walk(payload, bucketName, sign, stats) as T;
    return { payload: refreshed, stats };
  } catch {
    return { payload, stats };
  }
}
