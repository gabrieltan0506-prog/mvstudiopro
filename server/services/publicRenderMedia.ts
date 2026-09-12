import { randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { getGcsBucketName, signGcsObjectPathV4ReadUrl, uploadStreamToGcs } from "./gcs";

const PUBLIC_RENDER_PATH = /^gcs-renders\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(?:rendered-video\.mp4|scene-voice-track\.mp3)$/;
export type PublicRenderFileName = "rendered-video.mp4" | "scene-voice-track.mp3";

/** 公开分享只开放本次生成的独立空间，不解码或规范化调用方路径。 */
export function isPublicRenderObjectPath(value: string): boolean {
  return PUBLIC_RENDER_PATH.exec(value)?.[0] === value;
}

export function buildPublicRenderMediaUrl(objectName: string): string {
  if (!isPublicRenderObjectPath(objectName)) throw new Error("invalid_public_render_path");
  const base = (String(process.env.OAUTH_SERVER_URL || "").trim() || "https://mvstudiopro.com").replace(/\/+$/, "");
  return `${base}/api/jobs?op=blobMedia&blobPath=${encodeURIComponent(objectName)}`;
}

/** 返回短期跳转地址；持久化产物只能保存 buildPublicRenderMediaUrl 的稳定地址。 */
export function signPublicRenderMediaRedirect(objectName: string): string {
  if (!isPublicRenderObjectPath(objectName)) throw new Error("invalid_public_render_path");
  return signGcsObjectPathV4ReadUrl(getGcsBucketName(), objectName, 3600);
}

export async function uploadFileToPublicRenderMedia(filePath: string, fileName: PublicRenderFileName): Promise<string> {
  const objectName = `gcs-renders/${randomUUID()}/${fileName}`;
  const stableUrl = buildPublicRenderMediaUrl(objectName);
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error("empty_render_media");
  await uploadStreamToGcs({
    objectName,
    stream: Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>,
    contentLength: stat.size,
    contentType: fileName === "rendered-video.mp4" ? "video/mp4" : "audio/mpeg",
    // 与公开媒体上传共用120秒边界，鉴权或网络停滞时让调用方退出并清理临时文件。
    signal: AbortSignal.timeout(120_000),
  });
  return stableUrl;
}
