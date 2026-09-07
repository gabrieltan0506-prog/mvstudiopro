import { getGcsBucketName, signGsUriV4ReadUrl } from "./gcs.js";
import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource.js";

/** 队列等待后重新签本人素材；外部公共参考仍走原通道，不为外桶或他人资产签名。 */
export async function refreshCanvasAssetEditReference(
  source: string,
  userId: string,
  deps = {
    bucket: getGcsBucketName,
    resolve: resolveRegisteredPostProdMediaSource,
    sign: signGsUriV4ReadUrl,
  }
): Promise<string> {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error("参考图地址无效，尚未调用图片生成");
  }
  if (url.protocol !== "https:")
    throw new Error("参考图地址无效，尚未调用图片生成");
  if (
    url.hostname !== "storage.googleapis.com" ||
    url.pathname.split("/")[1] !== deps.bucket()
  )
    return source;
  const gcsUri = await deps.resolve({ userId, source });
  return deps.sign(gcsUri, 7 * 24 * 3600);
}
