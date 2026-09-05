import fs from "node:fs";
import crypto from "node:crypto";
import { getVertexAccessToken } from "../utils/vertex";

type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
};

const DEFAULT_GCS_BUCKET = "mv-studio-pro-vertex-video-temp";
const GCS_VIDEO_OBJECT_PREFIX = "growth-camp/videos";

export function getGcsBucketName() {
  return String(
    process.env.GCS_BUCKET_NAME
      || process.env.GROWTH_CAMP_GCS_BUCKET
      || process.env.VERTEX_GCS_BUCKET
      || process.env.GOOGLE_CLOUD_STORAGE_BUCKET
      || DEFAULT_GCS_BUCKET,
  ).trim();
}

function getGcsUserProject() {
  const explicitUserProject = String(process.env.GCS_USER_PROJECT || "").trim();
  if (explicitUserProject) return explicitUserProject;

  const requesterPaysEnabled = /^(1|true|yes|on)$/i.test(String(process.env.GCS_REQUESTER_PAYS || "").trim());
  if (!requesterPaysEnabled) return "";

  return String(process.env.VERTEX_PROJECT_ID || "").trim();
}

function normalizeObjectName(name: string) {
  return name
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9/_\-.]+/g, "-")
    .replace(/-{2,}/g, "-");
}

function parseGsUri(gcsUri: string) {
  const trimmed = String(gcsUri || "").trim();
  const match = trimmed.match(/^gs:\/\/([^/]+)\/(.+)$/i);
  if (!match) {
    throw new Error(`invalid_gcs_uri:${trimmed || "empty"}`);
  }
  return {
    bucket: match[1],
    objectName: normalizeObjectName(match[2]),
  };
}

function parseServiceAccountJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    const sanitized = raw.replace(
      /"private_key"\s*:\s*"([\s\S]*?)"/m,
      (_match, privateKey) => `"private_key": ${JSON.stringify(String(privateKey || ""))}`,
    );
    return JSON.parse(sanitized);
  }
}

function getGoogleServiceAccount(): ServiceAccountCredentials {
  const rawJson = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  if (rawJson) {
    const parsed = parseServiceAccountJson(rawJson);
    if (!parsed?.client_email || !parsed?.private_key) {
      throw new Error("invalid_GOOGLE_APPLICATION_CREDENTIALS_JSON");
    }
    return parsed;
  }

  const credentialsPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (credentialsPath) {
    const parsed = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
    if (!parsed?.client_email || !parsed?.private_key) {
      throw new Error("invalid_GOOGLE_APPLICATION_CREDENTIALS_file");
    }
    return parsed;
  }

  throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS");
}

function buildCanonicalHeaders(host: string, contentType: string, userProject?: string) {
  const normalizedContentType = String(contentType || "application/octet-stream").trim() || "application/octet-stream";
  const normalizedUserProject = String(userProject || "").trim();
  const headerLines = [
    `content-type:${normalizedContentType}`,
    `host:${host}`,
  ];
  const signedHeaders = ["content-type", "host"];
  if (normalizedUserProject) {
    headerLines.push(`x-goog-user-project:${normalizedUserProject}`);
    signedHeaders.push("x-goog-user-project");
  }
  return {
    contentType: normalizedContentType,
    userProject: normalizedUserProject,
    canonicalHeaders: `${headerLines.join("\n")}\n`,
    signedHeaders: signedHeaders.join(";"),
  };
}

export function isGsUri(value: string) {
  return /^gs:\/\//i.test(String(value || "").trim());
}

export function buildGrowthCampVideoObjectName(fileName?: string) {
  const safeName = String(fileName || "video.mp4")
    .replace(/[^a-z0-9._-]/gi, "-")
    .replace(/-{2,}/g, "-");
  return normalizeObjectName(`${GCS_VIDEO_OBJECT_PREFIX}/${Date.now()}-${safeName}`);
}

export function buildGrowthCampImageObjectName(fileName?: string) {
  const safeName = String(fileName || "image.png")
    .replace(/[^a-z0-9._-]/gi, "-")
    .replace(/-{2,}/g, "-");
  return normalizeObjectName(`growth-camp/images/${Date.now()}-${safeName}`);
}

export function getPublicGcsHttpsUrl(gcsUri: string) {
  const { bucket, objectName } = parseGsUri(gcsUri);
  return `https://storage.googleapis.com/${encodeURIComponent(bucket)}/${objectName.split("/").map(encodeURIComponent).join("/")}`;
}

export async function createGcsSignedUploadUrl(params: {
  fileName?: string;
  contentType: string;
  objectName?: string;
  expiresInMinutes?: number;
  /** 覆寫默認 GCS 桶（例如 PDF 異步 HTML 快照專用） */
  bucket?: string;
}): Promise<{ bucket: string; objectName: string; gcsUri: string; uploadUrl: string; requiredHeaders?: Record<string, string> }> {
  const bucket = String(params.bucket || "").trim() || getGcsBucketName();
  if (!bucket) {
    throw new Error("GCS bucket is not configured");
  }

  const credentials = getGoogleServiceAccount();
  const userProject = getGcsUserProject();
  const objectName = normalizeObjectName(params.objectName || buildGrowthCampVideoObjectName(params.fileName));
  const expiresInMinutes = Math.max(1, Math.min(60, Number(params.expiresInMinutes || 15) || 15));
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const datestamp = amzDate.slice(0, 8);
  const credentialScope = `${datestamp}/auto/storage/goog4_request`;
  const host = "storage.googleapis.com";
  const encodedObjectName = objectName.split("/").map(encodeURIComponent).join("/");
  const canonicalUri = `/${bucket}/${encodedObjectName}`;
  const { contentType, canonicalHeaders, signedHeaders } = buildCanonicalHeaders(host, params.contentType, userProject);

  const queryParams = new URLSearchParams({
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": `${credentials.client_email}/${credentialScope}`,
    "X-Goog-Date": amzDate,
    "X-Goog-Expires": String(expiresInMinutes * 60),
    "X-Goog-SignedHeaders": signedHeaders,
  });
  const canonicalQueryString = queryParams
    .toString()
    .split("&")
    .sort()
    .join("&");

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const hashedCanonicalRequest = crypto.createHash("sha256").update(canonicalRequest).digest("hex");
  const stringToSign = [
    "GOOG4-RSA-SHA256",
    amzDate,
    credentialScope,
    hashedCanonicalRequest,
  ].join("\n");

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(stringToSign);
  signer.end();
  const signature = signer.sign(credentials.private_key).toString("hex");
  queryParams.set("X-Goog-Signature", signature);

  return {
    bucket,
    objectName,
    gcsUri: `gs://${bucket}/${objectName}`,
    uploadUrl: `https://${host}${canonicalUri}?${queryParams.toString()}`,
    requiredHeaders: userProject ? { "x-goog-user-project": userProject } : undefined,
  };
}

export async function uploadBufferToGcs(params: {
  objectName: string;
  buffer: Buffer;
  contentType: string;
  /** Override the default GCS bucket — use for non-video uploads */
  bucket?: string;
  /** 任务时限结束时同步中止上传 */
  signal?: AbortSignal;
  /**
   * 条件覆写：只有对象仍是指定 generation 才写入。
   * 用于“读旧版 → 补字段 → 写回”流程，避免把并发产生的新版本覆盖掉。
   */
  ifGenerationMatch?: string;
}): Promise<{ bucket: string; objectName: string; gcsUri: string }> {
  params.signal?.throwIfAborted();
  const bucket = params.bucket || getGcsBucketName();
  if (!bucket) {
    throw new Error("GCS bucket is not configured");
  }

  const objectName = normalizeObjectName(params.objectName);
  const accessToken = await getVertexAccessToken();
  const uploadUrl = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`);
  uploadUrl.searchParams.set("uploadType", "media");
  uploadUrl.searchParams.set("name", objectName);
  if (params.ifGenerationMatch) {
    uploadUrl.searchParams.set("ifGenerationMatch", params.ifGenerationMatch);
  }
  const userProject = getGcsUserProject();
  if (userProject) {
    uploadUrl.searchParams.set("userProject", userProject);
  }

  // 調用方若在 GCP / Fly 與桶同區或近區，單次 media upload 延遲通常很低（與 Vertex 流水線銜接時宜同區桶）。
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": params.contentType || "application/octet-stream",
      "Content-Length": String(params.buffer.byteLength),
    },
    body: new Uint8Array(params.buffer),
    signal: params.signal,
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`gcs_upload_failed:${response.status}:${JSON.stringify(json || {})}`);
  }

  return {
    bucket,
    objectName,
    gcsUri: `gs://${bucket}/${objectName}`,
  };
}

/**
 * 条件创建:仅当对象不存在时写入(ifGenerationMatch=0)。
 * 已存在返回 { created:false }(GCS 412 Precondition Failed),其余错误照抛。
 * 供所有权登记簿等"先到先得"场景做真原子创建——get→put 两步在并发下必被覆盖。
 */
export async function uploadBufferToGcsIfAbsent(params: {
  objectName: string;
  buffer: Buffer;
  contentType: string;
  bucket?: string;
  /** GCS 对象自定义 metadata；传入时用单次 multipart 原子创建，避免媒体上传后补写失败。 */
  metadata?: Record<string, string>;
}): Promise<{ created: boolean; generation?: string }> {
  const bucket = params.bucket || getGcsBucketName();
  if (!bucket) throw new Error("GCS bucket is not configured");
  const objectName = normalizeObjectName(params.objectName);
  const accessToken = await getVertexAccessToken();
  const uploadUrl = new URL(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`,
  );
  const objectMetadata = Object.fromEntries(Object.entries(params.metadata || {})
    .map(([key, value]) => [String(key || "").trim(), String(value ?? "").trim()] as const)
    .filter(([key, value]) => key.length > 0 && key.length <= 128 && value.length <= 1_024));
  const hasMetadata = Object.keys(objectMetadata).length > 0;
  uploadUrl.searchParams.set("uploadType", hasMetadata ? "multipart" : "media");
  if (!hasMetadata) uploadUrl.searchParams.set("name", objectName);
  uploadUrl.searchParams.set("ifGenerationMatch", "0");
  const userProject = getGcsUserProject();
  if (userProject) uploadUrl.searchParams.set("userProject", userProject);
  const boundary = `mvstudiopro-${crypto.randomBytes(12).toString("hex")}`;
  const multipartBody = hasMetadata
    ? Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
          + `${JSON.stringify({ name: objectName, contentType: params.contentType, metadata: objectMetadata })}\r\n`
          + `--${boundary}\r\nContent-Type: ${params.contentType || "application/octet-stream"}\r\n\r\n`,
          "utf8",
        ),
        params.buffer,
        Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
      ])
    : params.buffer;
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": hasMetadata
        ? `multipart/related; boundary=${boundary}`
        : params.contentType || "application/octet-stream",
      "Content-Length": String(multipartBody.byteLength),
    },
    body: new Uint8Array(multipartBody),
  });
  if (response.status === 412) {
    await response.text().catch(() => "");
    return { created: false };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`gcs_conditional_upload_failed:${response.status}:${text.slice(0, 300)}`);
  }
  const metadata = await response.json().catch(() => null) as { generation?: unknown } | null;
  const generation = String(metadata?.generation || "").trim();
  return { created: true, ...(generation ? { generation } : {}) };
}

export async function downloadGcsObject(params: {
  gcsUri: string;
}): Promise<{ buffer: Buffer; bucket: string; objectName: string }> {
  const { bucket, objectName } = parseGsUri(params.gcsUri);
  const accessToken = await getVertexAccessToken();
  const downloadUrl = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`);
  downloadUrl.searchParams.set("alt", "media");
  const userProject = getGcsUserProject();
  if (userProject) {
    downloadUrl.searchParams.set("userProject", userProject);
  }

  const response = await fetch(downloadUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`gcs_download_failed:${response.status}:${text}`);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    bucket,
    objectName,
  };
}

export type GcsObjectBoundedInspection = {
  bucket: string;
  objectName: string;
  byteLength: number;
  /** 只保留格式验真所需的文件头，不把整个大对象常驻内存。 */
  header: Buffer;
  sha256: string;
};

/**
 * 对大对象做有界流式验真。共用 downloadGcsObject 的既有行为保持不变；
 * 仅需要文件头、总长度和摘要的调用方应走这里，避免先整包 arrayBuffer 再限流。
 */
export async function inspectGcsObjectBounded(params: {
  gcsUri: string;
  maxBytes: number;
  headerBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<GcsObjectBoundedInspection> {
  const { bucket, objectName } = parseGsUri(params.gcsUri);
  const maxBytes = Math.max(1, Math.floor(Number(params.maxBytes) || 0));
  const headerBytes = Math.max(1, Math.min(4_096, Math.floor(Number(params.headerBytes) || 12)));
  const timeoutMs = Math.max(10, Math.min(10 * 60_000, Math.floor(Number(params.timeoutMs) || 120_000)));
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = params.signal ? AbortSignal.any([params.signal, timeoutSignal]) : timeoutSignal;
  signal.throwIfAborted();

  const accessToken = await getVertexAccessToken();
  const downloadUrl = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`);
  downloadUrl.searchParams.set("alt", "media");
  const userProject = getGcsUserProject();
  if (userProject) downloadUrl.searchParams.set("userProject", userProject);

  const response = await fetch(downloadUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`gcs_download_failed:${response.status}`);
  }

  const declaredBytes = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("gcs_download_too_large");
  }
  if (!response.body) throw new Error("gcs_download_empty");

  const header = Buffer.alloc(headerBytes);
  let headerLength = 0;
  let byteLength = 0;
  const hash = crypto.createHash("sha256");
  const reader = response.body.getReader();
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      byteLength += chunk.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("gcs_download_too_large");
      }
      hash.update(chunk);
      if (headerLength < headerBytes) {
        const copyBytes = Math.min(headerBytes - headerLength, chunk.byteLength);
        chunk.copy(header, headerLength, 0, copyBytes);
        headerLength += copyBytes;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    bucket,
    objectName,
    byteLength,
    header: header.subarray(0, headerLength),
    sha256: hash.digest("hex"),
  };
}

/** 按前缀列出对象名（最多 maxResults，自动翻页直到凑满或无更多） */
const GCS_LIST_MAX_ATTEMPTS = 3;

export async function listGcsObjectNamesByPrefix(params: {
  prefix: string;
  maxResults?: number;
  bucket?: string;
  /**
   * true 时按调用方给出的文件名前缀原样查询，不自动补目录分隔符。
   * 默认仍按目录前缀处理，保持现有调用点行为。
   */
  literalPrefix?: boolean;
}): Promise<string[]> {
  const bucket = params.bucket || getGcsBucketName();
  if (!bucket) throw new Error("GCS bucket is not configured");
  const requestedPrefix = String(params.prefix || "");
  const prefix = params.literalPrefix
    ? normalizeObjectName(requestedPrefix)
    : normalizeObjectName(requestedPrefix.replace(/\/?$/, "/")).replace(/\/?$/, "/");
  // 上限 1000：原来钳到 500，而原生精读的集号范围是 1–999，
  // 一个系列超过 500 张卡后列举会截断，后面的集被当成「没跑过」重复付费。
  const maxResults = Math.max(1, Math.min(1000, Math.floor(Number(params.maxResults) || 100)));
  const accessToken = await getVertexAccessToken();
  const userProject = getGcsUserProject();
  const names: string[] = [];
  let pageToken = "";
  while (names.length < maxResults) {
    const url = new URL(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`,
    );
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("maxResults", String(Math.min(100, maxResults - names.length)));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    if (userProject) url.searchParams.set("userProject", userProject);
    // 列举是断点续跑的「已入库核对」真源，一次 fetch failed 就把整轮学习判死太脆：
    // 网络层错误与 5xx/429 退避重试三次，4xx 仍即时失败（0904 实锤：fetch failed 直接判死）。
    let response: Response | undefined;
    let lastNetworkError: unknown;
    for (let attempt = 0; attempt < GCS_LIST_MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
      try {
        response = await fetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        lastNetworkError = undefined;
        if (response.status < 500 && response.status !== 429) break;
        // 要重试的响应把 body 读掉，别占着连接
        if (attempt < GCS_LIST_MAX_ATTEMPTS - 1) await response.text().catch(() => undefined);
      } catch (error) {
        lastNetworkError = error;
        response = undefined;
      }
    }
    if (!response) {
      const detail = lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError);
      throw new Error(`gcs_list_failed:network:${detail}（已重试 ${GCS_LIST_MAX_ATTEMPTS} 次）`);
    }
    const json = (await response.json().catch(() => null)) as {
      items?: Array<{ name?: string }>;
      nextPageToken?: string;
      error?: unknown;
    } | null;
    if (!response.ok) {
      throw new Error(`gcs_list_failed:${response.status}:${JSON.stringify(json?.error || json || {})}`);
    }
    for (const item of json?.items || []) {
      const name = String(item?.name || "").trim();
      if (name && !name.endsWith("/")) names.push(name);
      if (names.length >= maxResults) break;
    }
    pageToken = String(json?.nextPageToken || "").trim();
    if (!pageToken) break;
  }
  return names;
}

export async function deleteGcsObject(params: {
  bucket?: string;
  objectName: string;
  /**
   * 条件删除：只有对象仍是这个 generation 才删。
   * 用于「读旧版 → 归档 → 删原件」这类流程——期间若有人写入新版本，
   * 无条件 DELETE 会把刚写的新版本一起删掉。
   */
  ifGenerationMatch?: string;
}): Promise<void> {
  const bucket = params.bucket || getGcsBucketName();
  if (!bucket) {
    throw new Error("GCS bucket is not configured");
  }

  const objectName = normalizeObjectName(params.objectName);
  const accessToken = await getVertexAccessToken();
  const deleteUrl = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`);
  const userProject = getGcsUserProject();
  if (userProject) {
    deleteUrl.searchParams.set("userProject", userProject);
  }
  if (params.ifGenerationMatch) {
    deleteUrl.searchParams.set("ifGenerationMatch", params.ifGenerationMatch);
  }

  const response = await fetch(deleteUrl, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 404) return;
  // 412 = 对象已被别的写入替换，此时删除会毁掉新版本，必须停手
  if (response.status === 412) {
    throw new Error("gcs_delete_generation_conflict");
  }
  if (!response.ok) {
    const json = await response.json().catch(() => null);
    throw new Error(`gcs_delete_failed:${response.status}:${JSON.stringify(json || {})}`);
  }
}

/**
 * 带版本号下载：同时取回内容与 generation，供后续条件删除使用。
 * 分两次请求（先 metadata 拿 generation，再按该 generation 取 media），
 * 保证拿到的内容与 generation 是同一版。
 */
export async function statGcsObjectVersion(params: {
  gcsUri: string;
}): Promise<{ bucket: string; objectName: string; generation: string; etag?: string }> {
  const { bucket, objectName } = parseGsUri(params.gcsUri);
  const accessToken = await getVertexAccessToken();
  const userProject = getGcsUserProject();
  const metaUrl = new URL(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`,
  );
  if (userProject) metaUrl.searchParams.set("userProject", userProject);
  const metaRes = await fetch(metaUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!metaRes.ok) throw new Error(`gcs_stat_failed:${metaRes.status}`);
  const meta = (await metaRes.json()) as { generation?: string; etag?: string };
  const generation = String(meta.generation || "").trim();
  if (!generation) throw new Error("gcs_stat_no_generation");
  return {
    bucket,
    objectName,
    generation,
    etag: String(meta.etag || "").trim() || undefined,
  };
}

export async function downloadGcsObjectVersioned(params: {
  gcsUri: string;
}): Promise<{ buffer: Buffer; bucket: string; objectName: string; generation: string }> {
  const version = await statGcsObjectVersion(params);
  const { bucket, objectName, generation } = version;
  const accessToken = await getVertexAccessToken();
  const userProject = getGcsUserProject();
  const metaUrl = new URL(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`,
  );
  if (userProject) metaUrl.searchParams.set("userProject", userProject);
  const mediaUrl = new URL(metaUrl.toString());
  mediaUrl.searchParams.set("alt", "media");
  mediaUrl.searchParams.set("generation", generation);
  const mediaRes = await fetch(mediaUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!mediaRes.ok) {
    throw new Error(`gcs_download_failed:${mediaRes.status}`);
  }
  return {
    buffer: Buffer.from(await mediaRes.arrayBuffer()),
    bucket,
    objectName,
    generation,
  };
}

/**
 * V4 GET 直链（object 路径按段 encodeURIComponent，**不做** normalizeObjectName）。
 * 用于把已存在于桶内的对象的「裸」https://storage.googleapis.com/BUCKET/OBJECT 换成可匿名读的签名 URL。
 */
export function signGcsObjectPathV4ReadUrl(
  bucket: string,
  /** 已解码的对象名，可含 `/` */
  objectPath: string,
  expiresSeconds = 3600,
): string {
  const credentials = getGoogleServiceAccount();
  const b = String(bucket || "").trim();
  const on = String(objectPath || "").replace(/^\/+/, "");
  if (!b || !on) {
    throw new Error("invalid_gcs_object_path");
  }
  const encodedObject = on
    .split("/")
    .filter((seg) => seg.length > 0)
    .map(encodeURIComponent)
    .join("/");
  const expiry = Math.max(60, Math.min(7 * 24 * 3600, Math.floor(expiresSeconds)));
  const now = Math.floor(Date.now() / 1000);
  const dateIso = new Date(now * 1000).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const datePart = dateIso.slice(0, 8);
  const credentialScope = `${datePart}/auto/storage/goog4_request`;
  const credential = `${credentials.client_email}/${credentialScope}`;
  const host = "storage.googleapis.com";
  const headers = `host:${host}\n`;
  const signedHeaders = "host";
  const canonicalRequest = [
    "GET",
    `/${b}/${encodedObject}`,
    `X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=${encodeURIComponent(credential)}&X-Goog-Date=${dateIso}&X-Goog-Expires=${expiry}&X-Goog-SignedHeaders=${signedHeaders}`,
    headers,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const hash = crypto.createHash("sha256").update(canonicalRequest).digest("hex");
  const stringToSign = `GOOG4-RSA-SHA256\n${dateIso}\n${credentialScope}\n${hash}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(stringToSign);
  sign.end();
  const signature = sign.sign(credentials.private_key).toString("hex");
  return `https://${host}/${b}/${encodedObject}?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=${encodeURIComponent(credential)}&X-Goog-Date=${dateIso}&X-Goog-Expires=${expiry}&X-Goog-SignedHeaders=${signedHeaders}&X-Goog-Signature=${signature}`;
}

/** V4 GET 签名直链（供客户下载 PDF 等），默认 1h；最大 7 天（與 GCS V4 實務上限對齊）。 */
export function signGsUriV4ReadUrl(gsUri: string, expiresSeconds = 3600): string {
  const { bucket, objectName } = parseGsUri(gsUri);
  return signGcsObjectPathV4ReadUrl(bucket, objectName, expiresSeconds);
}

export function resolvePdfExportBucketName(): string {
  return String(
    process.env.GCS_PDF_EXPORT_BUCKET || process.env.GCS_BUCKET_NAME || getGcsBucketName(),
  ).trim() || getGcsBucketName();
}
