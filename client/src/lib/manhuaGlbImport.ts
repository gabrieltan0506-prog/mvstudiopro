export const MANHUA_GLB_IMPORT_MAX_BYTES = 250 * 1024 * 1024;

/** 上传前的本地快检；服务端仍会重新下载并执行同一类 GLB 2.0 验真。 */
export async function assertValidManhuaGlbFile(file: File): Promise<void> {
  if (!/\.glb$/i.test(file.name)) {
    throw new Error("请选择 .glb 文件");
  }
  if (file.size < 12) {
    throw new Error("文件不是有效的 GLB 2.0 模型");
  }
  if (file.size > MANHUA_GLB_IMPORT_MAX_BYTES) {
    throw new Error("GLB 文件不能超过 250 MB");
  }
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const magic = String.fromCharCode(
    header[0] || 0,
    header[1] || 0,
    header[2] || 0,
    header[3] || 0,
  );
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (
    magic !== "glTF" ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== file.size
  ) {
    throw new Error("文件不是有效的 GLB 2.0 模型");
  }
}
