import { formatManhuaWriterPackMarkdown, type ManhuaWriterPack } from '@shared/manhuaWriterRoom';
import { readManhuaTimedStoryboard } from '@shared/manhuaTimedStoryboard';
import { retimeManhuaShot } from '@shared/manhuaShotTimingEdit';
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

/** 当前秒位表接管生产；旧分段保留为创作参考，不能再次被当作另一份生产计划。 */
export function retimeManhuaWriterPack(pack: ManhuaWriterPack, episodeIndex: number, shotIndex: number,
  durationSec: number, canonical: ReturnType<typeof retimeManhuaShot>): ManhuaWriterPack {
  const episode = pack.episodes.find(item => item.index === episodeIndex);
  if (!episode) throw new Error('当前集剧本不存在，未保存。');
  const timed = readManhuaTimedStoryboard(episode.body);
  let body = timed.recognized ? retimeManhuaShot(episode.body, shotIndex, durationSec).text
    : `${episode.body}\n\n## 分镜表\n\n${canonical.table}`;
  // 只更改旧段落的标题；表演、灯光、对白等原始文字全部留下，修复已保存的混合稿亦可重复执行。
  body = body.replace(/^(#{2,4})[ \t]*段[ \t]*0*(\d+)[ \t]*$/gm,
    '$1 原分段参考 $2（非当前分镜）');
  const saved = readManhuaTimedStoryboard(body);
  const timing = (rows: typeof saved.rows) => rows.map(row => [row.index, row.startSec, row.endSec]);
  if (saved.errors.length || JSON.stringify(timing(saved.rows)) !== JSON.stringify(timing(canonical.rows)))
    throw new Error('剧本与分镜秒位不一致，未保存，请先统一原稿。');
  const next = { ...pack, episodes: pack.episodes.map(item => item.index === episodeIndex ? {...item, body} : item) };
  next.rawMarkdown = formatManhuaWriterPackMarkdown({ ...next, rawMarkdown: '' });
  return next;
}
