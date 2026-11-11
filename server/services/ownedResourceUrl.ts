/**
 * 自有资源地址白名单：服务端代取图片、PDF 渲染加载外链资源时，只允许本站与自有存储。
 *
 * 放行：
 * - 本站：mvstudiopro.com / www.mvstudiopro.com / mvstudiopro.fly.dev / `${FLY_APP_NAME}.fly.dev`
 * - 自有 GCS 桶：storage.googleapis.com/<桶>/… 与 <桶>.storage.googleapis.com/…（桶名取各 *_BUCKET 环境变量 + 默认桶）
 * - 自有 S3 兼容存储：AWS_ENDPOINT_URL_S3 主机 + /<BUCKET_NAME>/ 前缀
 * - 自有 Vercel Blob：由 BLOB_READ_WRITE_TOKEN / MVSP_READ_WRITE_TOKEN 推出的 <storeId>.public.blob.vercel-storage.com
 * - 额外主机：OWNED_MEDIA_HOSTS（逗号分隔，精确主机名）
 * 一律只收 https、默认端口、无账号密码；IP 字面量、localhost、内网主机名一律拒绝。
 */

const SITE_HOSTS = ["mvstudiopro.com", "www.mvstudiopro.com", "mvstudiopro.fly.dev"];
const DEFAULT_GCS_BUCKET = "mv-studio-pro-vertex-video-temp";
const BUCKET_ENVS = [
  "GCS_BUCKET_NAME",
  "GROWTH_CAMP_GCS_BUCKET",
  "VERTEX_GCS_BUCKET",
  "GCS_PDF_EXPORT_BUCKET",
  "GCS_USER_UPLOAD_BUCKET",
  "GOOGLE_CLOUD_STORAGE_BUCKET",
  "ENTERPRISE_KB_BUCKET",
];

type Env = Record<string, string | undefined>;

export type OwnedResourcePolicy = {
  hosts: Set<string>;
  gcsBuckets: Set<string>;
  s3: { host: string; bucket: string } | null;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function blobHostFromToken(token: string): string | null {
  // vercel_blob_rw_<storeId>_<secret>
  const match = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(token);
  return match ? `${match[1]!.toLowerCase()}.public.blob.vercel-storage.com` : null;
}

export function ownedResourcePolicy(env: Env = process.env): OwnedResourcePolicy {
  const hosts = new Set(SITE_HOSTS);
  const flyApp = clean(env.FLY_APP_NAME);
  if (/^[a-z0-9-]+$/i.test(flyApp)) hosts.add(`${flyApp.toLowerCase()}.fly.dev`);
  for (const extra of clean(env.OWNED_MEDIA_HOSTS).split(",")) {
    const host = extra.trim().toLowerCase();
    if (host && /^[a-z0-9.-]+$/.test(host) && host.includes(".")) hosts.add(host);
  }
  for (const tokenEnv of ["BLOB_READ_WRITE_TOKEN", "MVSP_READ_WRITE_TOKEN"]) {
    const host = blobHostFromToken(clean(env[tokenEnv]));
    if (host) hosts.add(host);
  }
  const gcsBuckets = new Set([DEFAULT_GCS_BUCKET]);
  for (const name of BUCKET_ENVS) {
    const bucket = clean(env[name]);
    if (/^[a-z0-9._-]+$/.test(bucket)) gcsBuckets.add(bucket);
  }
  let s3: OwnedResourcePolicy["s3"] = null;
  const endpoint = clean(env.AWS_ENDPOINT_URL_S3);
  const s3Bucket = clean(env.BUCKET_NAME);
  if (endpoint && s3Bucket) {
    try {
      const u = new URL(endpoint);
      if (u.protocol === "https:") s3 = { host: u.hostname.toLowerCase(), bucket: s3Bucket };
    } catch {
      /* 无效 endpoint 不放行 */
    }
  }
  return { hosts, gcsBuckets, s3 };
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || host.includes(":");
}

/** 绝对地址（含 // 开头的协议相对地址）是否属于本站 / 自有存储。相对地址、data: 不在此函数判断。 */
export function isOwnedResourceUrl(raw: string, policy: OwnedResourcePolicy = ownedResourcePolicy()): boolean {
  let value = clean(raw);
  if (value.startsWith("//")) value = `https:${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (!host || isIpLiteral(host) || host === "localhost" || !host.includes(".")) return false;
  if (policy.hosts.has(host)) return true;
  if (host === "storage.googleapis.com") {
    const bucket = decodeURIComponent(url.pathname.split("/")[1] || "");
    return policy.gcsBuckets.has(bucket);
  }
  if (host.endsWith(".storage.googleapis.com")) {
    return policy.gcsBuckets.has(host.slice(0, -".storage.googleapis.com".length));
  }
  if (policy.s3 && host === policy.s3.host) {
    return url.pathname.startsWith(`/${policy.s3.bucket}/`);
  }
  return false;
}

/** CSP 源列表（PDF 渲染用）：本站主机 + 自有桶路径。 */
export function ownedResourceCspSources(policy: OwnedResourcePolicy = ownedResourcePolicy()): string[] {
  const sources = Array.from(policy.hosts).map(h => `https://${h}`);
  for (const bucket of Array.from(policy.gcsBuckets)) {
    sources.push(`https://storage.googleapis.com/${bucket}/`, `https://${bucket}.storage.googleapis.com`);
  }
  if (policy.s3) sources.push(`https://${policy.s3.host}/${policy.s3.bucket}/`);
  return sources;
}
