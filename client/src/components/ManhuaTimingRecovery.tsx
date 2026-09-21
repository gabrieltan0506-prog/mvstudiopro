import { useState } from 'react';
import { readManhuaTimedStoryboard } from '@shared/manhuaTimedStoryboard';
import { parseManhuaEpisodeSegmentPlanFromMarkdown } from '@shared/manhuaEpisodeSegmentPlan';

/** 旧版镜长保存形成混合稿时，在大纲页提供可见恢复入口。 */
export function ManhuaTimingRecovery({ body, disabled, onRepair }: {
  body: string; disabled?: boolean; onRepair?: (shotIndex: number, durationSec: number) => void;
}) {
  const [error, setError] = useState('');
  const timed = readManhuaTimedStoryboard(body);
  if (!onRepair || !timed.recognized || timed.errors.length || !timed.rows.length ||
      !parseManhuaEpisodeSegmentPlanFromMarkdown(body).segments.length) return null;
  const first = timed.rows[0];
  return <section data-manhua-timing-recovery className="mt-3 rounded-xl border border-amber-300/30 bg-amber-500/10 p-4 text-sm">
    <p>旧分段说明与当前镜头表重复。保留已调整的镜头时长，旧说明完整留下作为参考。</p>
    <button type="button" disabled={disabled} className="mt-3 min-h-11 rounded-lg border border-amber-300/40 px-4 disabled:opacity-40"
      onClick={() => { try { onRepair(first.index, first.endSec - first.startSec); setError(''); }
        catch (e) { setError(e instanceof Error ? e.message : '整理失败，原稿保留。'); } }}>
      保留当前镜头表，整理旧说明
    </button>
    {error && <p role="alert" className="mt-2 text-rose-200">{error}</p>}
  </section>;
}
