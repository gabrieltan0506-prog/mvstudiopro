import type { ManhuaLearnServerJob } from "@/lib/jobs";
import type { ManhuaNativeStructuringModelId } from "@shared/manhuaNativeDeepReadJob";

export function ManhuaRestructureControl({ job, disabled, onRestructure }: {
  job: ManhuaLearnServerJob;
  disabled: boolean;
  onRestructure: (job: ManhuaLearnServerJob, episodeIndex: number, model: ManhuaNativeStructuringModelId) => void;
}) {
  void job; void disabled; void onRestructure;
  return null;
}
