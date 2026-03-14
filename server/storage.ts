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

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);

  if (!ENV.blobReadWriteToken) {
    return {
      key,
      url: buildLocalDataUrl(data, contentType),
    };
  }

  const body =
    typeof data === "string"
      ? Buffer.from(data)
      : Buffer.from(data);

  const blob = await put(key, body, {
    access: "public",
    token: ENV.blobReadWriteToken,
    contentType,
  });

  return { key, url: blob.url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: key };
}
