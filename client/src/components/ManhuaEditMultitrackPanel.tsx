/**
 * 剪辑阶段 · 多轨骨架（D1）：V1 静帧 / V2 成片 / A1 对白 / 字幕占位。
 */
import { Scissors } from "lucide-react";
import {
  buildManhuaEditMultitrack,
  type ManhuaEditTrack,
} from "@shared/manhuaEditMultitrack";
import type { ManhuaRoughCutClip } from "@shared/manhuaEditWorkflowBank";
import type { ManhuaWorkbenchShot } from "@shared/manhuaScriptWorkbench";
import { listRoughTimelineStages } from "@shared/manhuaEditWorkflowBank";

type Props = {
  roughClips: ManhuaRoughCutClip[];
  shots: ManhuaWorkbenchShot[];
  stillIndexes: Set<number>;
  clipIndexes: Set<number>;
  activeShotIndex?: number;
  onSelectShot?: (shotIndex: number) => void;
  onReorder?: (orderedShotIndexes: number[]) => void;
  /** D2 前仅占位开关，不落轨数据 */
  subtitleEnabled?: boolean;
  onSubtitleEnabledChange?: (next: boolean) => void;
};

function TrackRow({
  track,
  activeShotIndex,
  onSelectShot,
}: {
  track: ManhuaEditTrack;
  activeShotIndex?: number;
  onSelectShot?: (shotIndex: number) => void;
}) {
  return (
    <div className="flex gap-2" data-manhua-edit-track={track.kind}>
      <div className="w-16 shrink-0 pt-1">
        <div className="text-[10px] font-semibold text-white/75">{track.nameZh}</div>
        <div className="mt-0.5 text-[8px] leading-snug text-white/35">{track.hintZh}</div>
      </div>
      <div className="relative min-h-[36px] flex-1 overflow-hidden rounded-md border border-white/10 bg-black/50">
        {track.segments.map((seg) => {
          const on = seg.shotIndex === activeShotIndex;
          return (
            <button
              key={`${track.kind}-${seg.shotIndex}-${seg.order}`}
              type="button"
              title={`${seg.labelZh} · ${seg.durationSec}s`}
              onClick={() => onSelectShot?.(seg.shotIndex)}
              style={{
                left: `${seg.startRatio * 100}%`,
                width: `${seg.widthRatio * 100}%`,
              }}
              className={`absolute top-1 bottom-1 overflow-hidden rounded border px-1 text-left ${
                on
                  ? "border-violet-400/55 bg-violet-500/25"
                  : seg.hasMedia
                    ? "border-cyan-400/30 bg-cyan-500/15"
                    : "border-white/10 bg-white/[0.04]"
              }`}
            >
              <div className="truncate text-[9px] font-medium text-white/85">{seg.labelZh}</div>
              <div className="text-[8px] text-white/40">{seg.durationSec}s</div>
            </button>
          );
        })}
        {!track.segments.length ? (
          <div className="flex h-9 items-center px-2 text-[10px] text-white/30">暂无片段</div>
        ) : null}
      </div>
    </div>
  );
}

export default function ManhuaEditMultitrackPanel({
  roughClips,
  shots,
  stillIndexes,
  clipIndexes,
  activeShotIndex,
  onSelectShot,
  onReorder,
  subtitleEnabled = false,
  onSubtitleEnabledChange,
}: Props) {
  const { totalSec, tracks } = buildManhuaEditMultitrack({
    roughClips,
    shots,
    stillIndexes,
    clipIndexes,
    subtitleEnabled,
  });
  const stages = listRoughTimelineStages();

  const move = (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= roughClips.length) return;
    const next = roughClips.map((c) => c.shotIndex);
    const tmp = next[from]!;
    next[from] = next[to]!;
    next[to] = tmp;
    onReorder?.(next);
  };

  return (
    <section
      data-manhua-panel="edit-multitrack"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-white/90">
            <Scissors className="h-4 w-4 text-violet-200" />
            剪辑台
            <span className="text-[11px] font-normal text-white/40">
              约 {totalSec}s · 粗剪序驱动
            </span>
          </div>
          <p className="mt-1 max-w-xl text-[10px] leading-relaxed text-white/40">
            多轨预览：静帧 / 成片 / 对白提示 / 字幕占位。细剪进出点与烧字开关将逐步开放。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {stages.map((s) => (
            <span
              key={s.id}
              className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[8px] text-white/45"
              title={s.jobZh}
            >
              {s.nameZh}
            </span>
          ))}
          <label className="ml-1 inline-flex items-center gap-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-[9px] text-white/55">
            <input
              type="checkbox"
              checked={subtitleEnabled}
              onChange={(e) => onSubtitleEnabledChange?.(e.target.checked)}
              className="accent-violet-400"
            />
            字幕轨占位
          </label>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-white/10 bg-black/35 p-2.5">
        {tracks.map((t) => (
          <TrackRow
            key={t.kind}
            track={t}
            activeShotIndex={activeShotIndex}
            onSelectShot={onSelectShot}
          />
        ))}
        <div className="relative mt-1 h-3 border-t border-dashed border-white/15">
          <div
            className="absolute top-0 bottom-0 w-px bg-rose-400/80"
            style={{ left: "0%" }}
            title="播放头"
          />
          <div className="absolute inset-x-0 top-0.5 flex justify-between px-0.5 text-[8px] text-white/30">
            <span>0s</span>
            <span>{Math.round(totalSec / 2)}s</span>
            <span>{totalSec}s</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
        <div className="text-[10px] font-semibold text-white/60">粗剪顺序</div>
        <div className="mt-1.5 flex gap-1 overflow-x-auto pb-0.5">
          {roughClips.map((c, i) => (
            <div
              key={`ord-${c.shotIndex}`}
              className={`flex min-w-[96px] shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 ${
                c.shotIndex === activeShotIndex
                  ? "border-violet-400/45 bg-violet-500/15"
                  : "border-white/10 bg-black/40"
              }`}
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  className="text-[9px] text-white/35 hover:text-white/70"
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="text-[9px] text-white/35 hover:text-white/70"
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
              </div>
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => onSelectShot?.(c.shotIndex)}
              >
                <div className="text-[10px] font-semibold text-white/85">
                  {String(c.order).padStart(2, "0")}·镜{c.shotIndex}
                </div>
                <div className="truncate text-[8px] text-white/40">{c.labelZh}</div>
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
