import { withLongJobsFlyDirect } from "./longJobsFlyOrigin";

/** 白模媒体必须经正式 Fly API 拉取；外部历史地址保持原样。 */
export function manhuaPrevisMediaUrl(value: string): string {
  return value.startsWith("/api/manhua-previs-media/")
    ? withLongJobsFlyDirect(value)
    : value;
}
