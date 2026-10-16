import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource";

/** 只收紧歌曲操作新前缀；旧素材读权限保持原规则。 */
export async function assertSongOperationMaterialRead(
  userId: number,
  gcsUri: string,
  resolve: typeof resolveRegisteredPostProdMediaSource = resolveRegisteredPostProdMediaSource,
): Promise<void> {
  const match = /^gs:\/\/([^/]+)\/(.+)$/i.exec(gcsUri.trim());
  if (!match) return;
  // 与GCS签名器的对象规范化一致，避免重复横线/前导斜线绕过前缀门禁。
  const objectName = match[2].replace(/^\/+/, "").replace(/[^a-zA-Z0-9/_\-.]+/g, "-").replace(/-{2,}/g, "-");
  if (objectName.startsWith("song-operations/"))
    throw new Error("歌曲处理证据仅供服务端核对，请通过原任务查看结果");
  if (!objectName.startsWith("song-operation-media/")) return;
  if (!Number.isSafeInteger(userId) || userId <= 0 || !objectName.startsWith(`song-operation-media/${userId}/`))
    throw new Error("无权读取此歌曲产物");
  const canonical = `gs://${match[1]}/${objectName}`;
  // 新前缀不属于自动允许的post-prod：必须在本人的成功任务明确产物字段中登记。
  const verified = await resolve({ userId: String(userId), source: canonical });
  if (verified !== canonical) throw new Error("歌曲产物来源不一致");
}
