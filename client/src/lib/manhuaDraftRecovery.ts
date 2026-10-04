import { manhuaProjectStorage as storage } from "@shared/manhuaProjectScope";
import { MANHUA_NOVEL_ORIGIN_KEY } from "@shared/manhuaNovelOrigin";

export const CLOUD_DRAFT_BASE_KEY = "mv-manhua-cloud-draft-base-generation-v1";
export function readDraftBaseGeneration(): string | null {
  try { return storage.getItem(CLOUD_DRAFT_BASE_KEY); } catch { return null; }
}
export function clearDraftBaseGeneration() {
  try { storage.removeItem(CLOUD_DRAFT_BASE_KEY); } catch { /* 后续版本条件仍保护云端 */ }
}
export function saveDraftBaseGeneration(generation: string) {
  try { storage.setItem(CLOUD_DRAFT_BASE_KEY, generation); } catch { /* 内存继续保护；重开时缺凭据将暂停同步 */ }
}
export function isCloudDraftConflict(error: unknown): boolean {
  const e = error as { data?: { code?: string }; shape?: { data?: { code?: string } } };
  return e?.data?.code === "CONFLICT" || e?.shape?.data?.code === "CONFLICT";
}
/** 仅列出本作品的数据键，绝不枚举账号凭据或其他项目。保留坏JSON原文以便取回。 */
export function captureLocalDraftRecovery(source: Pick<Storage, "getItem"> = storage) {
  const raw: Record<string, string> = {};
  const errors: string[] = [];
  for (const key of ["mv-manhua-writer-session-v1", "mv-freeform-canvas-v1",
    "mv-manhua-factory-character-prefs-v1", "mv-manhua-cloud-draft-local-at-v1",
    "mv-manhua-asset-stash-v1", MANHUA_NOVEL_ORIGIN_KEY, CLOUD_DRAFT_BASE_KEY]) {
    try { const value = source.getItem(key); if (value !== null) raw[key] = value; }
    catch { errors.push(key); }
  }
  let writer: Record<string, unknown> | null = null;
  try { writer = JSON.parse(raw["mv-manhua-writer-session-v1"] || "null"); } catch { /* 原文仍可导出 */ }
  return { format: "mv-manhua-local-recovery-v1", capturedAt: new Date().toISOString(), raw, errors,
    title: typeof writer?.topic === "string" ? writer.topic : "本机副本",
    preview: raw["mv-manhua-writer-session-v1"] || raw["mv-freeform-canvas-v1"] || "本机没有可读取的稿件",
  };
}
export function downloadLocalDraftRecovery(recovery = captureLocalDraftRecovery()) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(recovery, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = `漫剧本机原始副本-${Date.now()}.json`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
