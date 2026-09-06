import { useState } from "react";
import type { ManhuaLearnServerJob } from "@/lib/jobs";
import { parseNativeStructuringModel, type ManhuaNativeStructuringModelId } from "@shared/manhuaNativeDeepReadJob";

export function ManhuaRestructureControl({ job, disabled, onRestructure }: {
  job: ManhuaLearnServerJob;
  disabled: boolean;
  onRestructure: (job: ManhuaLearnServerJob, episodeIndex: number, model: ManhuaNativeStructuringModelId) => void;
}) {
  const params = job.input?.params;
  const checkpoint = job.output?.nativePartialProposalCheckpoint as { episodeIndex?: number } | undefined;
  const [episode, setEpisode] = useState(String(params?.nativeStructuringEpisodeIndex || checkpoint?.episodeIndex || ""));
  if (params?.nativeDeepReadConfirmed !== true) return null;
  let previousModel: ManhuaNativeStructuringModelId;
  try {
    previousModel = parseNativeStructuringModel(params.nativeStructuringModel);
  } catch {
    // 无法识别历史配置时不显示切换入口，避免错误配置导致整页无法渲染。
    return null;
  }
  const model: ManhuaNativeStructuringModelId = previousModel === "glm-5.3" ? "qwen3.8-max" : "glm-5.3";
  const label = model === "glm-5.3" ? "GLM 5.3" : "Qwen 3.8 Max";
  const active = job.status === "running" || job.status === "queued";
  return <span className="inline-flex flex-wrap items-center gap-1.5">
    <label className="text-[10px] text-white/70">第 <input aria-label="重新整形集号" type="number" min="1" max="999" value={episode}
      onChange={event => setEpisode(event.target.value)} disabled={disabled}
      className="w-14 rounded border border-white/20 bg-black/30 px-1.5 py-1 text-white" /> 集</label>
    <button type="button" disabled={disabled || !Number.isInteger(Number(episode)) || Number(episode) < 1 || Number(episode) > 999}
      onClick={() => onRestructure(job, Number(episode), model)}
      className="rounded-md border border-sky-200/40 bg-sky-400/15 px-2.5 py-1 text-[10px] font-semibold text-sky-50 disabled:opacity-40">
      {active ? "停止后换 " : "换 "}{label} 仅重新整形
    </button>
  </span>;
}
