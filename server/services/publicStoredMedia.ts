import { randomUUID } from "node:crypto";
import { getGcsBucketName, signGcsObjectPathV4ReadUrl, uploadBufferToGcs } from "./gcs";

const PUBLIC_OBJECT = /^gcs-public\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/asset\.[a-z0-9]{1,10}$/;

export function isPublicStoredObjectPath(value: string): boolean {
  return PUBLIC_OBJECT.exec(value)?.[0] === value;
}

export function buildPublicStoredMediaUrl(objectName: string): string {
  if (!isPublicStoredObjectPath(objectName)) throw new Error("invalid_public_media_path");
  const base = (String(process.env.OAUTH_SERVER_URL || "").trim() || "https://mvstudiopro.com").replace(/\/+$/, "");
  return `${base}/api/jobs?op=blobMedia&blobPath=${encodeURIComponent(objectName)}`;
}

export function signPublicStoredMediaRedirect(objectName: string): string {
  if (!isPublicStoredObjectPath(objectName)) throw new Error("invalid_public_media_path");
  return signGcsObjectPathV4ReadUrl(getGcsBucketName(), objectName, 3600);
}

/** 替换原公开 Blob 写入；稳定地址不含凭证，旧业务 key 不作为可签任意对象路径。 */
export async function putPublicStoredMedia(
  legacyPathname: string,
  body: Buffer | Uint8Array,
  options: { access: "public"; contentType?: string },
): Promise<{ pathname: string; url: string }> {
  if (!body.byteLength) throw new Error("empty_public_media");
  const extension = /\.([a-zA-Z0-9]{1,10})$/.exec(legacyPathname)?.[1].toLowerCase() || "bin";
  const pathname = `gcs-public/${randomUUID()}/asset.${extension}`;
  const url = buildPublicStoredMediaUrl(pathname);
  await uploadBufferToGcs({
    objectName: pathname,
    buffer: Buffer.isBuffer(body) ? body : Buffer.from(body),
    contentType: options.contentType || "application/octet-stream",
    ifGenerationMatch: "0",
    signal: AbortSignal.timeout(120_000),
  });
  return { pathname, url };
}
