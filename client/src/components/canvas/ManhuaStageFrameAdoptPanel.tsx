/**
 * 视角图采用面板（0916）：把 3D 片场导出的视角图明确采用到本段某一镜。
 *
 * 为什么要这一层：导出时只把来源写进 ref.stageFrame（世界/机位/演员/集段），
 * 「采用到哪一镜」没有落点，出站时就只能靠中文标签猜。这里让创作者逐张点到具体 shotId，
 * 并把换世界/换演员/跨段导致的失效当场说清楚，而不是静默用旧图。
 */
import { useMemo } from "react";
import {
  evaluateManhuaStageFrameAdoption,
  formatManhuaStageFrameSourceZh,
  type ManhuaShotStageContext,
} from "@shared/manhuaStageFrameAdoption";
import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";

export type ManhuaStageFrameShotOption = { shotId: string; labelZh: string };

type Props = {
  /** 本段导出过视角图的参考图（有 stageFrame 的才会显示） */
  refs: readonly ManhuaCustomAssetRef[];
  /** 本段的镜头清单，shotId 用 manhuaActionPlanShotId 造 */
  shots: readonly ManhuaStageFrameShotOption[];
  /** 判失效用的本段当前状态（世界、演员、集段） */
  context: Omit<ManhuaShotStageContext, "shotId">;
  disabled?: boolean;
  /** 采用/取消采用同一个开关 */
  onToggleAdopt: (refId: string, shotId: string) => void;
  /** 人物 ref.id → 中文名，用于来源说明 */
  actorLabelOf?: (id: string) => string;
};

const btn = "rounded border border-cyan-300/30 px-2 py-0.5 text-[11px] text-cyan-50 disabled:opacity-40";
const btnOn = "rounded border border-cyan-300/70 bg-cyan-500/25 px-2 py-0.5 text-[11px] text-cyan-50";

export function ManhuaStageFrameAdoptPanel(props: Props) {
  const { refs, shots, context, disabled, onToggleAdopt, actorLabelOf } = props;
  const frames = useMemo(() => refs.filter((r) => r.stageFrame), [refs]);
  if (!frames.length) {
    return (
      <p className="text-[11px] text-white/45" data-stage-adopt-empty>
        本段还没有从 3D 片场导出的视角图。在上面的世界预览里选好机位后点「导出当前视角 PNG」，导出的图会出现在这里，再采用到具体某一镜。
      </p>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2 rounded border border-cyan-300/20 bg-cyan-500/5 p-2" data-stage-adopt-panel>
      <p className="text-[11px] text-cyan-100">
        采用到镜头
        <span className="ml-2 text-white/50">采用后这张图会作为该镜的参考进入出站请求；换世界、换人物或改段号会让采用失效并在这里说明原因。</span>
      </p>
      <ul className="flex flex-col gap-2">
        {frames.map((ref) => {
          const sourceZh = formatManhuaStageFrameSourceZh(ref, actorLabelOf);
          return (
            <li key={ref.id} className="flex flex-wrap items-center gap-2 text-[11px]" data-stage-frame-ref={ref.id}>
              <img src={ref.url} alt={ref.labelZh || ref.id} className="h-10 w-10 rounded object-cover" />
              <span className="min-w-[6rem] font-medium text-white/85">{ref.labelZh || ref.id}</span>
              <span className="text-white/45">{sourceZh}</span>
              <span className="ml-auto flex flex-wrap gap-1">
                {shots.map((shot) => {
                  const state = evaluateManhuaStageFrameAdoption(ref, { ...context, shotId: shot.shotId });
                  const title = state.adopted && !state.usable ? state.reasonZh : undefined;
                  return (
                    <button
                      key={shot.shotId}
                      type="button"
                      className={state.usable ? btnOn : btn}
                      disabled={disabled}
                      title={title}
                      data-shot-id={shot.shotId}
                      data-adopt-state={state.usable ? "usable" : state.adopted ? "stale" : "none"}
                      onClick={() => onToggleAdopt(ref.id, shot.shotId)}
                    >
                      {shot.labelZh}
                      {state.adopted && !state.usable ? " · 已失效" : ""}
                    </button>
                  );
                })}
              </span>
              {shots
                .map((shot) => ({ shot, state: evaluateManhuaStageFrameAdoption(ref, { ...context, shotId: shot.shotId }) }))
                .filter(({ state }) => state.adopted && !state.usable)
                .map(({ shot, state }) => (
                  <p key={`why-${shot.shotId}`} className="w-full text-[10px] text-amber-100" data-stale-reason={shot.shotId}>
                    {shot.labelZh}：{state.reasonZh}
                  </p>
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default ManhuaStageFrameAdoptPanel;
