import { resolveCanvasMaterialUrl } from "./omniCanvasApi";

/** 只还原存储身份；是否允许读取仍由已鉴权服务端决定。 */
export function assetImageGcsUri(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "storage.googleapis.com"
    )
      return;
    const parts = parsed.pathname.slice(1).split("/").map(decodeURIComponent);
    if (
      parts.length < 2 ||
      parts.some(
        part => !part || part === "." || part === ".." || part.includes("\\")
      )
    )
      return;
    return `gs://${parts.join("/")}`;
  } catch {
    return;
  }
}

export async function readAssetImageDimensions(
  url: string
): Promise<{ sourceWidth: number; sourceHeight: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const finish = () => {
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
    };
    const timer = setTimeout(() => {
      finish();
      img.src = "";
      reject(new Error("图片读取超时，尚未提交生成，请稍后重试"));
    }, 30_000);
    img.onload = () => {
      finish();
      if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) {
        reject(new Error("无法读取图片尺寸，尚未提交生成"));
        return;
      }
      resolve({
        sourceWidth: img.naturalWidth,
        sourceHeight: img.naturalHeight,
      });
    };
    img.onerror = () => {
      finish();
      reject(new Error("参考图无法读取，尚未提交生成，请重新选择图片"));
    };
    img.src = url;
  });
}

export async function refreshAssetImageUrl(ref: {
  url: string;
  gcsUri?: string;
}): Promise<string> {
  const gcsUri = ref.gcsUri || assetImageGcsUri(ref.url);
  const url = gcsUri ? await resolveCanvasMaterialUrl(gcsUri) : ref.url;
  if (!/^https:\/\//i.test(url))
    throw new Error("参考图地址无效，尚未提交生成");
  return url;
}

/** 每次点击读取当前原图；旧草稿缺尺寸、旧编辑图继承错误尺寸也不猜竖版。 */
export async function prepareAssetImageEdit(ref: {
  url: string;
  gcsUri?: string;
}) {
  const url = await refreshAssetImageUrl(ref);
  const dimensions = await readAssetImageDimensions(url);
  return {
    url,
    ...dimensions,
    aspectRatio:
      dimensions.sourceWidth >= dimensions.sourceHeight
        ? ("16:9" as const)
        : ("9:16" as const),
  };
}
