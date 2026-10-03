import { extractSystemObjectName, resolveRegisteredPostProdMediaSource } from "./postProdMediaSource.js";
import { getGcsBucketName, signGsUriV4ReadUrl } from "./gcs.js";
import { probePhotoVideoInput } from "./photoMediaInput.js";

/** 工作流成片先验证本人归属，再签名读取；外部散客入口仍沿原安全下载器。 */
export async function probeVideoEnhanceSource(userId: number, source: string, workflow: boolean) {
  const canonical = workflow || source.startsWith("gs://") || source.includes("/api/canvas-media/") || extractSystemObjectName(source, getGcsBucketName()) !== null
    ? await resolveRegisteredPostProdMediaSource({ userId: String(userId), source })
    : source;
  const url = canonical.startsWith("gs://") ? signGsUriV4ReadUrl(canonical, 3600) : canonical;
  const measured = await probePhotoVideoInput(url);
  return { ...measured, canonicalSource: canonical };
}

/** 用户明确导入WaveSpeed成品；先落本人目录，再沿工作流归属链处理。 */
export async function importVideoEnhanceSource(userId: number, source: string) {
  const parsed = new URL(source);
  if (parsed.protocol !== "https:" || parsed.hostname !== "d2h7xmz5gqybh9.cloudfront.net" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) throw new Error("仅支持导入WaveSpeed成品HTTPS链接");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { fetchPostProdSourceToFile, probe, uploadResult } = await import("./postProduction.js");
  const dir = await mkdtemp(path.join(tmpdir(), "enhance-import-"));
  const signal = AbortSignal.timeout(180_000);
  try {
    const filePath = path.join(dir, "source.mp4");
    await fetchPostProdSourceToFile(source, filePath, { signal });
    const metadata = await probe(filePath, signal);
    if (!metadata.width || !metadata.height || !metadata.fps || metadata.durationSec <= 0 || metadata.durationSec > 600) throw new Error("导入视频参数无效或超过600秒");
    return await uploadResult({ filePath, userId: String(userId), kind: "enhance-source", ext: "mp4", contentType: "video/mp4", signal });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
