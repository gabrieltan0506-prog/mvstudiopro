import { readAssetImageDimensions } from "./manhuaAssetImageSource";

/** MIME 仅是第一层筛选；没有类型的旧备份仍必须通过实际图片解码。 */
function allowsImageDecode(raw: string | undefined): boolean {
  const mime = String(raw || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  return (
    !mime || mime === "application/octet-stream" || /^image\/.+/.test(mime)
  );
}

/** 验证随包图片的真实可读性，不接受登录页、错误 JSON 或只有文件名的空产物。 */
export async function assertManhuaBackupImage(
  blob: Blob,
  mime?: string
): Promise<void> {
  if (!blob?.size) throw new Error("备份图片内容为空，请保留原文件并检查来源");
  if (!allowsImageDecode(mime) || !allowsImageDecode(blob.type)) {
    throw new Error("备份文件不是图片内容，请检查是否误存了错误页面");
  }
  let url: string | undefined;
  try {
    // ZIP 解包不携带文件 MIME；仅对无类型/通用二进制补清单类型，字节保持原样。
    // 已明确标成 HTML/JSON 的响应已在上面拒绝，不能用清单替它洗白。
    const declaredMime = String(mime || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    const decodeBlob =
      (!blob.type || blob.type === "application/octet-stream") &&
      declaredMime.startsWith("image/")
        ? new Blob([blob], { type: declaredMime })
        : blob;
    url = URL.createObjectURL(decodeBlob);
    const dimensions = await readAssetImageDimensions(url);
    if (
      !(
        Number.isFinite(dimensions.sourceWidth) &&
        dimensions.sourceWidth > 0 &&
        Number.isFinite(dimensions.sourceHeight) &&
        dimensions.sourceHeight > 0
      )
    ) {
      throw new Error("图片尺寸无效");
    }
  } catch {
    throw new Error("备份图片无法读取或已损坏，请保留原文件并检查来源");
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
