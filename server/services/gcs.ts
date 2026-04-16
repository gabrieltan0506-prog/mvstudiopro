import fs from "node:fs";
import crypto from "node:crypto";
import { getVertexAccessToken } from "../utils/vertex";

type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
};

const DEFAULT_GCS_BUCKET = "mv-studio-pro-vertex-video-temp";
const GCS_VIDEO_OBJECT_PREFIX = "growth-camp/videos";

function getGcsBucketName() {
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

export function getPublicGcsHttpsUrl(gcsUri: string) {
  const { bucket, objectName } = parseGsUri(gcsUri);
  return `https://storage.googleapis.com/${encodeURIComponent(bucket)}/${objectName.split("/").map(encodeURIComponent).join("/")}`;
}

export async function createGcsSignedUploadUrl(params: {
  fileName?: string;
  contentType: string;
  objectName?: string;
  expiresInMinutes?: number;
}): Promise<{ bucket: string; objectName: string; gcsUri: string; uploadUrl: string; requiredHeaders?: Record<string, string> }> {
  const bucket = getGcsBucketName();
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
}): Promise<{ bucket: string; objectName: string; gcsUri: string }> {
  const bucket = getGcsBucketName();
  if (!bucket) {
    throw new Error("GCS bucket is not configured");
  }

  const objectName = normalizeObjectName(params.objectName);
  const accessToken = await getVertexAccessToken();
  const uploadUrl = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`);
  uploadUrl.searchParams.set("uploadType", "media");
  uploadUrl.searchParams.set("name", objectName);
  const userProject = getGcsUserProject();
  if (userProject) {
    uploadUrl.searchParams.set("userProject", userProject);
  }

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": params.contentType || "application/octet-stream",
      "Content-Length": String(params.buffer.byteLength),
    },
    body: new Uint8Array(params.buffer),
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

export async function deleteGcsObject(params: {
  bucket?: string;
  objectName: string;
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

  const response = await fetch(deleteUrl, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 404) return;
  if (!response.ok) {
    const json = await response.json().catch(() => null);
    throw new Error(`gcs_delete_failed:${response.status}:${JSON.stringify(json || {})}`);
  }
}
