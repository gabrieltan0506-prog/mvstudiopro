/**
 * 漫剧实时推进板：集 × 阶段状态，生成时始终在可视区上方。
 */
import { useMemo } from "react";
import { Loader2, Square } from "lucide-react";
import type { CanvasBlock } from "@/lib/canvasTypes";
import {
  getBlockEpisodeIndex,
  MANHUA_FACTORY_STAGE_LABEL_ZH,
  MANHUA_FACTORY_STAGE_ORDER,
  stageKeyFromBlockId,
  type ManhuaFactoryStageKey,
} from "@/lib/canvasDramaStudio";

const TRACK_STAGES: ManhuaFactoryStageKey[] = [
  "story",
  "beats",
  "reverse",
  "keyart",
  "clip",
];

type EpRow = {
  ep: number;
  title?: string;
  stages: Record<
    string,
    { status: "idle" | "ready" | "running" | "error"; thumb?: string; label: string }
  >;
};

function mediaOf(b?: CanvasBlock): string | undefined {
  if (!b) return undefined;
  return b.outputUrl || b.outputUrls?.[0] || undefined;
}

type Props = {
  blocks: CanvasBlock[];
  focusEpisode: number;
  factoryBusy?: boolean;
  factoryProgress?: string;
  /** 生成中随时中断 */
  onStopFactory?: () => void;
  onFocusEpisode: (ep: number) => void;
  onFocusBlock?: (blockId: string) => void;
};

export default function ManhuaLiveProgressBoard({
  blocks,
  focusEpisode,
  factoryBusy,
  factoryProgress,
  onStopFactory,
  onFocusEpisode,
  onFocusBlock,
}: Props) {
  const rows = useMemo(() => {
    const byEp = new Map<number, CanvasBlock[]>();
    for (const b of blocks) {
      if (!MANHUA_FACTORY_STAGE_ORDER.some((s) => b.id.startsWith(`${s}-`))) continue;
      const ep = getBlockEpisodeIndex(b) ?? 1;
      const list = byEp.get(ep) || [];
      list.push(b);
      byEp.set(ep, list);
    }
    const eps = Array.from(byEp.keys()).sort((a, b) => a - b);
    if (!eps.length && focusEpisode) eps.push(focusEpisode);

    return eps.map((ep): EpRow => {
      const list = byEp.get(ep) || [];
      const title = list.find((b) => b.episodeTitle)?.episodeTitle;
      const stages: EpRow["stages"] = {};
      for (const stage of TRACK_STAGES) {
        const stageBlocks = list.filter((x) => stageKeyFromBlockId(x.id) === stage);
        const b = stageBlocks[0];
        const baseLabel = MANHUA_FACTORY_STAGE_LABEL_ZH[stage] || stage;
        if (!stageBlocks.length) {
          stages[stage] = { status: "idle", label: baseLabel };
          continue;
        }
        // 关键静帧/成片多节点：汇总已出张数，避免只看第一张导致「页面不同步」
        if (stage === "keyart" || stage === "clip") {
          const total = stageBlocks.length;
          const done = stageBlocks.filter((x) => Boolean(mediaOf(x))).length;
          const anyRunning = stageBlocks.some((x) => x.status === "running");
          const anyErr = stageBlocks.some((x) => x.status === "error" || Boolean(x.error));
          const running =
            anyRunning ||
            (factoryBusy && ep === focusEpisode && done < total && !(anyErr && done === 0));
          const label =
            total > 1 ? `${baseLabel} ${done}/${total}` : baseLabel;
          const thumb = stageBlocks.map(mediaOf).find(Boolean);
          // 仅全部出齐才标绿；部分完成绝不能伪装「已完成」
          const status =
            done >= total && total > 0
              ? "ready"
              : running
                ? "running"
                : anyErr && done < total
                  ? "error"
                  : done > 0 && done < total
                    ? "running"
                    : "idle";
          stages[stage] = {
            status,
            thumb,
            label,
          };
          continue;
        }
        const hasOut = Boolean(
          mediaOf(b) || (b?.outputText || "").trim() || b?.status === "done",
        );
        const err = Boolean(b?.error || b?.status === "error");
        const running =
          b?.status === "running" || (factoryBusy && !hasOut && !err && ep === focusEpisode);
        stages[stage] = {
          status: err ? "error" : hasOut ? "ready" : running ? "running" : "idle",
          thumb: undefined,
          label: baseLabel,
        };
      }
      return { ep, title, stages };
    });
  }, [blocks, focusEpisode, factoryBusy]);

  const hasChain = rows.some((r) =>
    TRACK_STAGES.some((s) => r.stages[s]?.status !== "idle"),
  );

  return (
    <div
      id="manhua-live-progress-zone"
      className="sticky top-[8.5rem] z-20 mt-3 scroll-mt-44 rounded-2xl border border-cyan-400/25 bg-[#0a121c]/95 px-3 py-3 shadow-[0_8px_28px_rgba(0,0,0,0.35)] backdrop-blur-md md:px-4"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-white/90">生成推进</span>
          <span className="rounded-full border border-cyan-400/35 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-medium text-cyan-100">
            实时
          </span>
          {factoryBusy ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-100/90">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {factoryProgress?.trim() || "工厂运行中…"}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {factoryBusy && onStopFactory ? (
            <button
              type="button"
              data-manhua-action="stop-factory-progress"
              onClick={onStopFactory}
              className="inline-flex items-center gap-1 rounded-md border border-red-400/45 bg-red-500/20 px-2.5 py-1 text-[10px] font-semibold text-red-50 hover:bg-red-500/30"
              title="立刻中断，不必跑完整条链"
            >
              <Square className="h-3 w-3 fill-current" />
              中断生成
            </button>
          ) : (
            <span className="text-[10px] text-white/35">点集可切换焦点 · 点阶段可定位节点</span>
          )}
        </div>
      </div>

      {!hasChain && !factoryBusy ? (
        <p className="rounded-xl border border-dashed border-white/15 bg-black/30 px-3 py-4 text-[11px] leading-relaxed text-white/45">
          确认编剧并「生成本集成片」后，这里会按集显示故事 → 节拍 → 反推 → 静帧 → 成片的推进；下方画布同步更新。
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const on = row.ep === focusEpisode;
            const keyartThumb = row.stages.keyart?.thumb || row.stages.clip?.thumb;
            return (
              <div
                key={row.ep}
                className={`rounded-xl border px-2.5 py-2 ${
                  on ? "border-cyan-400/45 bg-cyan-500/10" : "border-white/10 bg-black/35"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onFocusEpisode(row.ep)}
                    className="flex min-w-0 items-center gap-2 text-left"
                  >
                    <div className="h-12 w-9 shrink-0 overflow-hidden rounded-md bg-black/50">
                      {keyartThumb ? (
                        <img src={keyartThumb} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[9px] text-white/30">
                          —
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-white/88">第{row.ep}集</div>
                      <div className="truncate text-[10px] text-white/40">
                        {row.title || "未命名"}
                      </div>
                    </div>
                  </button>
                  <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                    {TRACK_STAGES.map((stage) => {
                      const cell = row.stages[stage];
                      const st = cell?.status || "idle";
                      const b = blocks.find(
                        (x) =>
                          stageKeyFromBlockId(x.id) === stage &&
                          (getBlockEpisodeIndex(x) ?? 1) === row.ep,
                      );
                      return (
                        <button
                          key={stage}
                          type="button"
                          disabled={!b}
                          onClick={() => b && onFocusBlock?.(b.id)}
                          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium disabled:opacity-40 ${
                            st === "ready"
                              ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-50"
                              : st === "running"
                                ? "border-amber-400/45 bg-amber-500/15 text-amber-50"
                                : st === "error"
                                  ? "border-red-400/40 bg-red-500/15 text-red-100"
                                  : "border-white/10 text-white/35"
                          }`}
                          title={cell?.label}
                        >
                          {st === "running" ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : null}
                          {cell?.label && /\d+\/\d+/.test(cell.label)
                            ? cell.label
                            : cell?.label?.slice(0, 2) || stage}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
