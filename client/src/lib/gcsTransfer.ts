import { isGcsTransferUrl } from "../../../shared/gcsTransfer";
import { withLongJobsFlyDirect } from "./longJobsFlyOrigin";
export { isGcsTransferUrl };
/** 原签名/对象身份不变，仅将传输跳点改为Fly。 */
export function gcsTransferUrl(url: string): string {
  return isGcsTransferUrl(url)
    ? withLongJobsFlyDirect(`/api/gcs-transfer?url=${encodeURIComponent(url)}`)
    : url;
}
