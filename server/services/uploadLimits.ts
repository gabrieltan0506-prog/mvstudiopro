/** 单文件上传大小上限，一处真源：服务端直收（/api/upload）与浏览器直传签名链接共用。缺省 600MB，可用 UPLOAD_MAX_BYTES 调整（不低于 10MB）。 */
const MB = 1024 * 1024;
export const DEFAULT_UPLOAD_MAX_BYTES = 600 * MB;

export function resolveUploadMaxBytes(): number {
  return Math.max(10 * MB, Number(process.env.UPLOAD_MAX_BYTES || DEFAULT_UPLOAD_MAX_BYTES) || DEFAULT_UPLOAD_MAX_BYTES);
}
