/**
 * 平台追问附件（/api/platform/upload → createPlatformQAJob → worker 读完即删）的归属约定，一处真源。
 * 附件只落 QA 桶的 platform-qa/u<本人uid>/ 下；入队只收本人前缀，worker 执行前再核一次只收 platform-qa/ 下的对象，
 * 其余 gs://（别的桶、别的目录）与任何 https 链接一律拒绝 —— 不交给模型、不删除。
 */

/** Bucket 走 env（历史原因见 server/upload.ts 注释），最差回退到 fly 上现存的临时桶。 */
export function resolvePlatformQaBucket(): string {
  return (
    process.env.GCS_USER_UPLOAD_BUCKET ||
    process.env.GCS_PDF_EXPORT_BUCKET ||
    process.env.VERTEX_GCS_BUCKET ||
    "mv-studio-pro-vertex-video-temp"
  );
}

export const PLATFORM_QA_FILE_FORBIDDEN = "platform_qa_file_not_allowed";
const PLATFORM_QA_ROOT = "platform-qa/";
const FILE_NAME_RE = /^[0-9A-Za-z_-][0-9A-Za-z._-]*$/;

export function platformQaUserPrefix(userId: string | number): string {
  const safeUser = String(userId).replace(/[^0-9a-zA-Z_-]/g, "");
  if (!safeUser) throw new Error(PLATFORM_QA_FILE_FORBIDDEN);
  return `${PLATFORM_QA_ROOT}u${safeUser}/`;
}

function parseOwnBucketObject(fileUri: string, bucket: string): string {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(String(fileUri ?? "").trim());
  if (!match || !bucket || match[1] !== bucket) throw new Error(PLATFORM_QA_FILE_FORBIDDEN);
  return match[2];
}

/** 入队核验：必须是本人前缀下的单层文件。返回规范 gs://。 */
export function assertOwnPlatformQaFileUri(
  fileUri: string,
  userId: string | number,
  bucket: string = resolvePlatformQaBucket(),
): string {
  const objectName = parseOwnBucketObject(fileUri, bucket);
  const prefix = platformQaUserPrefix(userId);
  const rest = objectName.slice(prefix.length);
  if (!objectName.startsWith(prefix) || !FILE_NAME_RE.test(rest) || rest.includes("..")) {
    throw new Error(PLATFORM_QA_FILE_FORBIDDEN);
  }
  return `gs://${bucket}/${objectName}`;
}

/**
 * worker 执行前核验（任务不带用户身份）：只收 QA 桶 platform-qa/ 下的附件 ——
 * 新格式 platform-qa/u<uid>/<文件>，以及改造前已入队的旧格式 platform-qa/<文件>。
 */
export function assertPlatformQaWorkerFileUri(
  fileUri: string,
  bucket: string = resolvePlatformQaBucket(),
): { bucket: string; objectName: string; gcsUri: string } {
  const objectName = parseOwnBucketObject(fileUri, bucket);
  const segments = objectName.split("/");
  const ok =
    objectName.startsWith(PLATFORM_QA_ROOT) &&
    !objectName.includes("..") &&
    ((segments.length === 2 && FILE_NAME_RE.test(segments[1]!)) ||
      (segments.length === 3 && /^u[0-9A-Za-z_-]+$/.test(segments[1]!) && FILE_NAME_RE.test(segments[2]!)));
  if (!ok) throw new Error(PLATFORM_QA_FILE_FORBIDDEN);
  return { bucket, objectName, gcsUri: `gs://${bucket}/${objectName}` };
}
