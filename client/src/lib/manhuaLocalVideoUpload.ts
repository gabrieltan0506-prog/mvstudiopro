/** 原片只通过同源接口上传到服务器私有存储；这里不申请或使用 GCS 上传地址。 */
import {
  MANHUA_LOCAL_VIDEO_CHUNK_BYTES,
  MANHUA_LOCAL_VIDEO_MAX_BYTES,
  MANHUA_LOCAL_VIDEO_UPLOAD_ID,
  parseManhuaLocalVideoSourceRef,
} from "@shared/manhuaLocalVideoUpload";
export { MANHUA_LOCAL_VIDEO_CHUNK_BYTES, MANHUA_LOCAL_VIDEO_MAX_BYTES };
export const MANHUA_LOCAL_VIDEO_UPLOAD_PATH = "/api/manhua/local-video-uploads";
const UPLOAD_ID = MANHUA_LOCAL_VIDEO_UPLOAD_ID;

export type ManhuaLocalVideoUpload = {
  uploadId: string;
  status: "uploading" | "completed";
  fileName: string;
  bytes: number;
  offset: number;
  sha256?: string;
  durationSec?: number;
  sourceRef?: string;
};

export type CompletedManhuaLocalVideoUpload = ManhuaLocalVideoUpload & {
  status: "completed";
  sha256: string;
  durationSec: number;
  sourceRef: string;
};

export function readManhuaLocalVideoSource(
  sourceRef: unknown,
): { userKey: string; uploadId: string; sha256: string } | null {
  const source = parseManhuaLocalVideoSourceRef(sourceRef);
  return source ? { userKey: source.userId, uploadId: source.uploadId, sha256: source.sha256 } : null;
}

/** 本地缓存也要保持来源与上传编号、当前账号一致；真正权限仍由服务端重新校验。 */
export function isManhuaLocalVideoSource(
  row: { url?: unknown; localVideoUploadId?: unknown },
  userKey?: string,
): boolean {
  const source = readManhuaLocalVideoSource(row.url);
  return Boolean(source && source.uploadId === row.localVideoUploadId
    && (!userKey || source.userKey === userKey));
}

export function parseManhuaLocalVideoUpload(value: unknown): ManhuaLocalVideoUpload {
  const row = value as Partial<ManhuaLocalVideoUpload> | null;
  if (!row || typeof row !== "object" || !UPLOAD_ID.test(String(row.uploadId || ""))
    || (row.status !== "uploading" && row.status !== "completed")
    || typeof row.fileName !== "string" || !row.fileName.trim()
    || !Number.isSafeInteger(row.bytes) || Number(row.bytes) <= 0 || Number(row.bytes) > MANHUA_LOCAL_VIDEO_MAX_BYTES
    || !Number.isSafeInteger(row.offset) || Number(row.offset) < 0 || Number(row.offset) > Number(row.bytes)) {
    throw new Error("视频上传回执不完整，请保留当前上传并重试查询。");
  }
  const result: ManhuaLocalVideoUpload = {
    uploadId: row.uploadId!, status: row.status, fileName: row.fileName,
    bytes: row.bytes!, offset: row.offset!,
  };
  if (row.status === "completed") {
    const source = readManhuaLocalVideoSource(row.sourceRef);
    if (row.offset !== row.bytes || !source || source.uploadId !== row.uploadId || source.sha256 !== row.sha256
      || typeof row.durationSec !== "number" || !Number.isFinite(row.durationSec) || row.durationSec <= 0) {
      throw new Error("视频尚未通过完整校验，不能开始学习。");
    }
    Object.assign(result, { sha256: row.sha256, sourceRef: row.sourceRef, durationSec: row.durationSec });
  }
  return result;
}

export function assertCompletedManhuaLocalVideoUpload(
  value: unknown,
  userKey: string,
): CompletedManhuaLocalVideoUpload {
  const upload = parseManhuaLocalVideoUpload(value);
  if (upload.status !== "completed" || !isManhuaLocalVideoSource({
    url: upload.sourceRef, localVideoUploadId: upload.uploadId,
  }, userKey)) throw new Error("视频还未完成上传校验，或不属于当前账号。");
  return upload as CompletedManhuaLocalVideoUpload;
}

type UploadRequest = (url: string, init: RequestInit) => Promise<Response>;
type RequestOptions = { signal?: AbortSignal; request?: UploadRequest };

async function requestUpload(
  suffix: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<ManhuaLocalVideoUpload> {
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  const stop = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("上传请求超时", "TimeoutError")), 120_000);
  try {
    const response = await (options.request ?? fetch)(MANHUA_LOCAL_VIDEO_UPLOAD_PATH + suffix, {
      ...init,
      credentials: "same-origin",
      headers: { "X-Manhua-Upload": "1", ...init.headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      // 不把代理HTML、服务端路径或原始错误直接展示给用户。
      if (response.status === 401 || response.status === 403) throw new Error("请以站点拥有者账号登录后上传。");
      if (response.status === 413) throw new Error("视频或上传分块超过限制，本次未提交学习。");
      if (response.status === 422) throw new Error("不是可读取的视频，请重新选择文件并上传。");
      if (response.status === 507) throw new Error("服务器空间不足，请等待管理员处理后继续上传。");
      if (response.status === 404) throw new Error("上传记录不存在，请重新选择视频并上传。");
      if (response.status === 409) throw new Error("上传进度已变化，请继续上传以核对服务器进度。");
      throw new Error("上传暂未确认，请继续上传以核对原上传进度。");
    }
    const data = await response.json().catch(() => { throw new Error("上传响应无法确认，请稍后查询原上传。"); });
    return parseManhuaLocalVideoUpload(data);
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason || new DOMException("已暂停上传", "AbortError");
    if (controller.signal.aborted) throw new Error("上传请求超时，请继续上传以核对原上传进度。");
    throw error instanceof TypeError ? new Error("网络暂不可用，请继续上传以核对原上传进度。") : error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", stop);
  }
}

export async function getManhuaLocalVideoUpload(uploadId: string, options: RequestOptions = {}): Promise<ManhuaLocalVideoUpload> {
  if (!UPLOAD_ID.test(uploadId)) throw new Error("上传编号无效，请重新选择视频。");
  const upload = await requestUpload(`/${uploadId}`, { method: "GET" }, options);
  if (upload.uploadId !== uploadId) throw new Error("上传回执与原编号不一致，已停止恢复。");
  return upload;
}

/** 只有仍握有同一个 File 对象的页面可以续传，刷新后不靠文件名/大小猜测内容相同。 */
export type ManhuaLocalVideoUploadAttempt = { file: File; upload: ManhuaLocalVideoUpload };

export async function uploadManhuaLocalVideo(input: RequestOptions & {
  file: File;
  previous?: ManhuaLocalVideoUploadAttempt | null;
  userKey: string;
  onCheckpoint: (attempt: ManhuaLocalVideoUploadAttempt) => void;
  onProgress: (offset: number, bytes: number) => void;
}): Promise<CompletedManhuaLocalVideoUpload> {
  const { file, previous } = input;
  if (!file.size || file.size > MANHUA_LOCAL_VIDEO_MAX_BYTES) throw new Error("请选择非空视频，单个文件最多 800MB。");
  if (previous && previous.file !== file) throw new Error("重新选择的文件不能拼接旧上传，请建立新的上传。");
  input.signal?.throwIfAborted();
  let upload = previous
    ? await getManhuaLocalVideoUpload(previous.upload.uploadId, input)
    : await requestUpload("", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, bytes: file.size }) }, input);
  const remember = (next: ManhuaLocalVideoUpload) => {
    if (next.uploadId !== upload.uploadId || next.bytes !== file.size) throw new Error("上传回执与当前文件不一致，已停止上传。");
    upload = next;
    input.onCheckpoint({ file, upload });
    input.onProgress(upload.offset, upload.bytes);
  };
  remember(upload);
  while (upload.status !== "completed" && upload.offset < file.size) {
    input.signal?.throwIfAborted();
    const end = Math.min(file.size, upload.offset + MANHUA_LOCAL_VIDEO_CHUNK_BYTES);
    const next = await requestUpload(`/${upload.uploadId}?offset=${upload.offset}`, {
      method: "PUT", headers: { "Content-Type": "application/octet-stream" },
      body: file.slice(upload.offset, end),
    }, input);
    if (next.offset !== end) throw new Error("分块回执偏移不一致，请继续上传以核对原上传。");
    remember(next);
  }
  if (upload.status !== "completed") {
    remember(await requestUpload(`/${upload.uploadId}/complete`, { method: "POST" }, input));
  }
  return assertCompletedManhuaLocalVideoUpload(upload, input.userKey);
}

const STORAGE_PREFIX = "mvs-manhua-local-video-upload-v1:";
export function saveManhuaLocalVideoUpload(userKey: string, upload: ManhuaLocalVideoUpload | null): void {
  if (!userKey) return;
  try {
    const key = STORAGE_PREFIX + encodeURIComponent(userKey);
    if (upload) localStorage.setItem(key, JSON.stringify(upload));
    else localStorage.removeItem(key);
  } catch { /* 存储不可用时保留当前页面的同一File与上传编号。 */ }
}

export function readSavedManhuaLocalVideoUpload(userKey: string): ManhuaLocalVideoUpload | null {
  if (!userKey) return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + encodeURIComponent(userKey));
    return raw ? parseManhuaLocalVideoUpload(JSON.parse(raw)) : null;
  } catch { return null; }
}
