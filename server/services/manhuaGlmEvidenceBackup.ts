import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

/** 服务端持久卷上的永久副本；不放/tmp、不自动清理，不代替GCS成功回执。 */
export async function backupManhuaGlmEvidence(
  objectName: string,
  buffer: Buffer,
  root = "/data/growth/manhua-glm-evidence",
): Promise<void> {
  const digest = createHash("sha256").update(buffer).digest("hex");
  const directory = path.join(root, createHash("sha256").update(objectName).digest("hex"));
  await fs.mkdir(directory, { recursive: true });
  // 内容寻址保留冲突的两个版本；不会覆盖旧付费证据。
  const target = path.join(directory, `${digest}.json`);
  let handle;
  try {
    handle = await fs.open(target, "wx", 0o600);
    await handle.writeFile(buffer);
    await handle.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await fs.readFile(target);
    if (!existing.equals(buffer)) throw new Error("glm_evidence_backup_content_mismatch");
  } finally {
    await handle?.close();
  }
  for (const dir of [directory, root]) {
    const directoryHandle = await fs.open(dir, "r");
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  }
}

/** 只提取允许的错误分类，绝不输出URL、响应正文、凭证或原始cause。 */
export function classifyManhuaGlmStorageError(error: unknown): string {
  const value = error as { code?: unknown; cause?: { code?: unknown }; message?: unknown } | null;
  const code = String(value?.code || value?.cause?.code || "");
  if (/^(?:EACCES|EPERM|ENOSPC|EIO|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/.test(code)) return code;
  const message = String(value?.message || "");
  const status = message.match(/^gcs_(?:conditional_upload|download|stat)_failed:(\d{3})(?::|$)/)?.[1];
  if (status) return `http_${status}`;
  if (message === "fetch failed") return "network_error";
  return "unknown_storage_error";
}
