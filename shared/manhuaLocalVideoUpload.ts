/** 原片只在服务端私有目录保存；这个身份不携带磁盘路径或访问凭证。 */
export const MANHUA_LOCAL_VIDEO_CHUNK_BYTES = 2 * 1024 * 1024;
export const MANHUA_LOCAL_VIDEO_MAX_BYTES = 800 * 1024 * 1024;
export const MANHUA_LOCAL_VIDEO_UPLOAD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const owner = /^[1-9][0-9]*$/;
const digest = /^[0-9a-f]{64}$/;
export function buildManhuaLocalVideoSourceRef(input: {
  userId: string | number;
  uploadId: string;
  sha256: string;
}): string {
  const userId = String(input.userId);
  if (
    !owner.test(userId) ||
    !MANHUA_LOCAL_VIDEO_UPLOAD_ID.test(input.uploadId) ||
    !digest.test(input.sha256)
  )
    throw new Error("本地视频来源身份无效");
  return `manhua-upload://u${userId}/${input.uploadId}/${input.sha256}`;
}
export function parseManhuaLocalVideoSourceRef(
  value: unknown
): { userId: string; uploadId: string; sha256: string } | null {
  if (typeof value !== "string") return null;
  const m = /^manhua-upload:\/\/u([1-9][0-9]*)\/([^/]+)\/([0-9a-f]{64})$/.exec(
    value
  );
  return m && MANHUA_LOCAL_VIDEO_UPLOAD_ID.test(m[2])
    ? { userId: m[1], uploadId: m[2], sha256: m[3] }
    : null;
}
