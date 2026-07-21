/**
 * 粗剪时间线：按镜排序片段，对接剪辑工作流节点（不接外部 NLE）。
 */
import { Film, GripVertical } from "lucide-react";
import {
  listRoughTimelineStages,
  roughCutTotalSec,
  type ManhuaRoughCutClip,
} from "@shared/manhuaEditWorkflowBank";

type Props = {
  clips: ManhuaRoughCutClip[];
  activeShotIndex?: number;
  onSelectShot?: (shotIndex: number) => void;
  onReorder?: (orderedShotIndexes: number[]) => void;
};

export default function ManhuaRoughEditTimeline({
  clips,
  activeShotIndex,
  onSelectShot,
  onReorder,
}: Props) {
  const stages = listRoughTimelineStages();
  const total = roughCutTotalSec(clips);

  const move = (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= clips.length) return;
    const next = clips.map((c) => c.shotIndex);
    const tmp = next[from]!;
    next[from] = next[to]!;
    next[to] = tmp;
    onReorder?.(next);
  };

  return (
    <section
      data-manhua-panel="rough-edit-timeline"
      className="border-t border-white/10 bg-black/50 px-2.5 py-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white/80">
          <Film className="h-3.5 w-3.5 text-violet-200/90" />
          粗剪轨
          <span className="font-normal text-white/40">
            {clips.length} 镜 · 约 {total}s
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {stages.map((s) => (
            <span
              key={s.id}
              className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[8px] text-white/45"
              title={`${s.jobZh}（${s.whenZh}）`}
            >
              {s.nameZh}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-1.5 flex gap-1 overflow-x-auto pb-0.5">
        {clips.length === 0 ? (
          <p className="text-[10px] text-white/35">分镜就绪后在此排粗剪顺序。</p>
        ) : (
          clips.map((c, i) => {
            const on = c.shotIndex === activeShotIndex;
            return (
              <div
                key={`${c.shotIndex}-${c.order}`}
                data-manhua-rough-clip={c.shotIndex}
                className={`flex min-w-[108px] max-w-[140px] shrink-0 items-stretch rounded-md border ${
                  on
                    ? "border-violet-400/50 bg-violet-500/15"
                    : "border-white/10 bg-white/[0.03]"
                }`}
              >
                {onReorder ? (
                  <div className="flex flex-col justify-center border-r border-white/8 px-0.5">
                    <button
                      type="button"
                      className="px-0.5 text-[9px] text-white/35 hover:text-white/70"
                      onClick={() => move(i, -1)}
                      title="前移"
                    >
                      ↑
                    </button>
                    <GripVertical className="mx-auto h-3 w-3 text-white/25" />
                    <button
                      type="button"
                      className="px-0.5 text-[9px] text-white/35 hover:text-white/70"
                      onClick={() => move(i, 1)}
                      title="后移"
                    >
                      ↓
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => onSelectShot?.(c.shotIndex)}
                  className="min-w-0 flex-1 px-1.5 py-1.5 text-left"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-semibold text-white/85">
                      {String(c.order).padStart(2, "0")}·镜{c.shotIndex}
                    </span>
                    <span className="text-[9px] text-white/40">{c.durationSec}s</span>
                  </div>
                  <div className="mt-0.5 line-clamp-1 text-[9px] text-white/50">{c.labelZh}</div>
                  <div className="mt-0.5 flex gap-1 text-[8px]">
                    <span className={c.hasStill ? "text-cyan-200/80" : "text-white/25"}>静帧</span>
                    <span className={c.hasClip ? "text-emerald-200/80" : "text-white/25"}>成片</span>
                  </div>
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
