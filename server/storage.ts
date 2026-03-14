import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { put } from "@vercel/blob";
import { ENV } from "./_core/env";

function buildLocalDataUrl(
  data: Buffer | Uint8Array | string,
  contentType: string,
): string {
  if (typeof data === "string") {
    const isInlineUrl = /^data:|^https?:\/\//.test(data);
    if (isInlineUrl) return data;
    return `data:${contentType};base64,${Buffer.from(data).toString("base64")}`;
  }

  return `data:${contentType};base64,${Buffer.from(data).toString("base64")}`;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function getS3Config() {
  const accessKeyId = String(process.env.AWS_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.AWS_SECRET_ACCESS_KEY || "").trim();
  const endpoint = String(process.env.AWS_ENDPOINT_URL_S3 || "").trim();
  const region = String(process.env.AWS_REGION || "auto").trim() || "auto";
  const bucket = String(process.env.BUCKET_NAME || "").trim();
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) return null;
  return { accessKeyId, secretAccessKey, endpoint, region, bucket };
}

function buildS3PublicUrl(endpoint: string, bucket: string, key: string) {
  const base = endpoint.replace(/\/+$/, "");
  return `${base}/${bucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
}

let s3Client: S3Client | null = null;

function getS3Client(config: NonNullable<ReturnType<typeof getS3Config>>) {
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return s3Client;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const body =
    typeof data === "string"
      ? Buffer.from(data)
      : Buffer.from(data);

  const s3Config = getS3Config();
  if (s3Config) {
    const client = getS3Client(s3Config);
    await client.send(new PutObjectCommand({
      Bucket: s3Config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
    return {
      key,
      url: buildS3PublicUrl(s3Config.endpoint, s3Config.bucket, key),
    };
  }

  const token = String(process.env.MVSP_READ_WRITE_TOKEN || ENV.blobReadWriteToken || "").trim();

  if (!token) {
    return {
      key,
      url: buildLocalDataUrl(data, contentType),
    };
  }

  const blob = await put(key, body, {
    access: "public",
    token,
    contentType,
  });

  return { key, url: blob.url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: key };
}
