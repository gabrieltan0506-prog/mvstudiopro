import { z } from "zod";

export const ADVISOR_BACKUP_PREFIX = "manhua-advisor-rewrite-backup:";
const backupSchema = z.object({
  createdAt: z.string().datetime(),
  episodeIndex: z.number().int().positive(),
  changes: z.array(z.string()),
  writerPack: z.object({
    seriesTitle: z.string(),
    episodes: z.array(z.object({ index: z.number().int().positive(), body: z.string() }).passthrough()).min(1),
  }).passthrough(),
  adoptedWriterPack: z.object({ seriesTitle: z.string(), episodes: z.array(z.object({ index: z.number(), body: z.string() }).passthrough()) }).passthrough().optional(),
  projectBible: z.object({ confirmedAt: z.string() }).passthrough().nullable(),
}).passthrough();
export type AdvisorBackupEntry = { key: string; createdAt: string; episodeIndex: number; seriesTitle: string; json: string };

/** 只读取当前账户及当前项目证据匹配的备份；保留原始JSON，下载不改写工程。 */
export function listAdvisorBackups(storage: Pick<Storage, "length" | "key" | "getItem">, scope: {
  userId: string; confirmedProjectVersion?: string; seriesTitle: string; episodeIndex: number; body: string; originalBody?: string;
}): { entries: AdvisorBackupEntry[]; errors: number } {
  const entries: AdvisorBackupEntry[] = [];
  let errors = 0;
  const prefix = `${ADVISOR_BACKUP_PREFIX}${scope.userId}:`;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      const json = storage.getItem(key);
      if (!json) continue;
      const backup = backupSchema.parse(JSON.parse(json));
      const adoptedBodyMatches = backup.episodeIndex === scope.episodeIndex && backup.adoptedWriterPack?.seriesTitle === scope.seriesTitle && backup.adoptedWriterPack.episodes.some(ep => ep.index === scope.episodeIndex && Boolean(scope.body) && ep.body === scope.body);
      const sameProject = adoptedBodyMatches || (scope.confirmedProjectVersion
        ? backup.projectBible?.confirmedAt === scope.confirmedProjectVersion
        : !backup.projectBible && backup.writerPack.seriesTitle === scope.seriesTitle && backup.writerPack.episodes.some(ep =>
          ep.index === scope.episodeIndex && Boolean(ep.body) && (ep.body === scope.body || ep.body === scope.originalBody)));
      if (!sameProject) continue;
      entries.push({ key, createdAt: backup.createdAt, episodeIndex: backup.episodeIndex, seriesTitle: backup.writerPack.seriesTitle, json });
    } catch { errors++; }
  }
  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { entries, errors };
}

export function downloadAdvisorBackup(entry: AdvisorBackupEntry): void {
  // 重新检查后下载原文，包括全部旧writerPack和Bible，不自动恢复或覆盖当前工程。
  backupSchema.parse(JSON.parse(entry.json));
  const url = URL.createObjectURL(new Blob([entry.json], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `漫剧旧稿-第${entry.episodeIndex}集-${entry.createdAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 只有本账户顾问采用的完整新稿与原项目版本一致，才限定再次确认的失效范围。 */
export function advisorReconfirmationFromEpisode(storage: Pick<Storage, "length" | "key" | "getItem">, userId: string, writerPack: unknown, confirmedProjectVersion?: string): number | undefined {
  let earliest: number | undefined;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(`${ADVISOR_BACKUP_PREFIX}${userId}:`)) continue;
    const json = storage.getItem(key);
    try {
      const backup = backupSchema.parse(JSON.parse(json || ""));
      if ((backup.projectBible?.confirmedAt || undefined) !== confirmedProjectVersion || !backup.adoptedWriterPack) continue;
      if (JSON.stringify(backup.adoptedWriterPack) !== JSON.stringify(backupSchema.shape.adoptedWriterPack.parse(writerPack))) continue;
      earliest = Math.min(earliest ?? backup.episodeIndex, backup.episodeIndex);
    } catch { /* 损坏旧记录不作为限定清理范围的依据。 */ }
  }
  return earliest;
}
