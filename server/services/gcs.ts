import { getVertexAccessToken } from "../utils/vertex";

function getGcsBucketName() {
  return String(
    process.env.GROWTH_CAMP_GCS_BUCKET
      || process.env.VERTEX_GCS_BUCKET
      || process.env.GOOGLE_CLOUD_STORAGE_BUCKET
      || "",
  ).trim();
}

function normalizeObjectName(name: string) {
  return name
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9/_\-.]+/g, "-")
    .replace(/-{2,}/g, "-");
}

export function isGsUri(value: string) {
  return /^gs:\/\//i.test(String(value || "").trim());
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
