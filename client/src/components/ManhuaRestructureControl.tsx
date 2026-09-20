import { MANHUA_NATIVE_STRUCTURING_MODEL } from "@shared/manhuaNativeDeepReadJob";
import { useState } from "react";
import type { ManhuaLearnServerJob } from "@/lib/jobs";
import type { ManhuaNativeStructuringModelId } from "@shared/manhuaNativeDeepReadJob";

export function ManhuaRestructureControl({ job, disabled, onRestructure }: {
  job: ManhuaLearnServerJob;
  disabled: boolean;
  onRestructure: (job: ManhuaLearnServerJob, episodeIndex: number, model: ManhuaNativeStructuringModelId) => void;
}) {
  const params = job.input?.params;
  const checkpoint = job.output?.nativePartialProposalCheckpoint as { episodeIndex?: number } | undefined;
  const [episode, setEpisode] = useState(String(params?.nativeStructuringEpisodeIndex || checkpoint?.episodeIndex || ""));
  if (params?.nativeDeepReadConfirmed !== true) return null;
  const active = job.status === "running" || job.status === "queued";
  return <span className="inline-flex flex-wrap items-center gap-1.5">
    <label className="text-[10px] text-white/70">第 <input aria-label="重新整形集号" type="number" min="1" max="999" value={episode}
      onChange={event => setEpisode(event.target.value)} disabled={disabled}
      className="w-14 rounded border border-white/20 bg-black/30 px-1.5 py-1 text-white" /> 集</label>
    <button type="button" disabled={disabled || !Number.isInteger(Number(episode)) || Number(episode) < 1 || Number(episode) > 999}
      onClick={() => onRestructure(job, Number(episode), MANHUA_NATIVE_STRUCTURING_MODEL)}
      className="rounded-md border border-sky-200/40 bg-sky-400/15 px-2.5 py-1 text-[10px] font-semibold text-sky-50 disabled:opacity-40">
      {active ? "停止后用 " : "用 "}GLM 5.3 仅重新整形
    </button>
  </span>;
}
