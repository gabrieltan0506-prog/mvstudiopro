import { isGcsTransferUrl } from "../../../shared/gcsTransfer";
import { withLongJobsFlyDirect } from "./longJobsFlyOrigin";
export { isGcsTransferUrl };
/** 原签名/对象身份不变，仅将传输跳点改为Fly。 */
export function gcsTransferUrl(url: string): string {
  return isGcsTransferUrl(url)
    ? withLongJobsFlyDirect(`/api/gcs-transfer?url=${encodeURIComponent(url)}`)
    : url;
}

/** 用户下载只连接Fly；其他云端产物须由服务端核验本人任务归属。 */
export function flyDownloadUrl(source: string): string {
  if (isGcsTransferUrl(source)) return gcsTransferUrl(source);
  if (source.startsWith("/")) return withLongJobsFlyDirect(source);
  try {
    const url = new URL(source);
    if (["www.mvstudiopro.com", "mvstudiopro.com", "api.mvstudiopro.com", "mvstudiopro.fly.dev"].includes(url.hostname) && url.protocol === "https:" && !url.username && !url.password && !url.port) return withLongJobsFlyDirect(url.pathname + url.search);
  } catch { /* 由服务端校验无效来源。 */ }
  return withLongJobsFlyDirect(`/api/manhua-media-download?url=${encodeURIComponent(source)}`);
}
