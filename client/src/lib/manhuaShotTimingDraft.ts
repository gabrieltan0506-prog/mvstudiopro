import { buildManhuaWriterSession, serializeManhuaWriterSession, MANHUA_WRITER_SESSION_LS_KEY, type ManhuaWriterSessionPartial } from '@shared/manhuaWriterSession';
import type { CanvasBlock, CanvasEdge } from './canvasTypes';
import { slimBlocksForLocalPersist } from './manhuaCloudDraftSync';

/** 时长修改必须同时保存剧本与画布，不使用截断原稿的配额降级路径。 */
export function saveManhuaShotTimingDraft(blocks: CanvasBlock[], edges: CanvasEdge[], writer: ManhuaWriterSessionPartial,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage) {
  const writerKey = MANHUA_WRITER_SESSION_LS_KEY;
  const oldWriter = storage.getItem(writerKey);
  const nextWriter = serializeManhuaWriterSession(buildManhuaWriterSession({ ...(oldWriter ? JSON.parse(oldWriter) : {}), ...writer }));
  const nextCanvas = JSON.stringify({ blocks: slimBlocksForLocalPersist(blocks), edges });
  let writerSaved = false;
  try {
    storage.setItem(writerKey, nextWriter);
    writerSaved = true;
    storage.setItem('mv-freeform-canvas-v1', nextCanvas);
  } catch {
    if (writerSaved) {
      try { if (oldWriter === null) storage.removeItem(writerKey); else storage.setItem(writerKey, oldWriter); }
      catch { throw new Error('时长保存失败且剧本回退失败，请勿刷新，先导出备份。'); }
    }
    throw new Error('本机空间不足或保存受限，时长未应用，原稿保留。');
  }
}
