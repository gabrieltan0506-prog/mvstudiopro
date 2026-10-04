import { captureLocalDraftRecovery, downloadLocalDraftRecovery } from "@/lib/manhuaDraftRecovery";

/** 云不可用时只读取和下载本机原文，不触发保存、恢复或付费任务。 */
export function ManhuaLocalRecovery({ onView }: { onView?: () => void }) {
  const copy = captureLocalDraftRecovery();
  const hasCopy = Object.keys(copy.raw).some(key => key !== "mv-manhua-cloud-draft-base-generation-v1");
  return <details className="my-3 rounded-lg border p-3" data-testid="manhua-local-recovery" onToggle={event => { if (event.currentTarget.open) onView?.(); }}>
    <summary>查看本机副本（只读）</summary>
    <p className="my-2 text-sm">{copy.title || "未命名作品"}。可能尚未同步；原始数据导出保留稿件、画布和来源记录，不含图片、音视频及3D文件的二进制。此文件供原文取回，不能直接当作工程备份导入。</p>
    {copy.errors.length > 0 && <p role="alert">部分本机存储无法读取，导出中会列出缺失项。</p>}
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{copy.preview}</pre>
    <button type="button" data-testid="manhua-local-export" disabled={!hasCopy} className="mt-3 rounded border px-3 py-2 disabled:opacity-50" onClick={() => downloadLocalDraftRecovery(copy)}>导出本机原始副本</button>
  </details>;
}
