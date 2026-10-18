import type { DigitalHumanDraft } from "@shared/digitalHumanStudio";
import { digitalHumanSegmentOutputs } from "@shared/digitalHumanProject";
import {
  buildPostProdClipOptions,
  jobsStorageKey,
  normalizeStoredJobs,
  postProdJobMatchesScope,
} from "./postProdWorkshop";

/** 段落后期输出也进入整片选片；只读取本段已完成任务，保留原始任务缓存。 */
export function digitalHumanProjectSegmentOutputs(draft: DigitalHumanDraft) {
  const scope = `digital-human:${draft.id}`;
  let saved: unknown = [];
  try {
    saved = JSON.parse(
      draft.postProdStorage[jobsStorageKey(draft.owner)] || "[]"
    );
  } catch {
    /* 损坏记录保留原稿，不作为成片候选。 */
  }
  const jobs = normalizeStoredJobs(saved, Number.POSITIVE_INFINITY).filter(
    job => postProdJobMatchesScope(job, scope)
  );
  const edited = buildPostProdClipOptions(jobs).map(clip => ({
    id: clip.id,
    source: clip.url,
    label: clip.label,
  }));
  const effects = jobs.flatMap(job => {
    if (job.action !== "manhua_vfx" || job.status !== "succeeded") return [];
    const source = job.output?.gcsUri || job.output?.url;
    return typeof source === "string" && /^(gs:\/\/|https:\/\/)/.test(source)
      ? [{ id: `effect:${job.jobId}`, source, label: "特效候选 · 待审后选择" }]
      : [];
  });
  const upscales = draft.videos.flatMap(video =>
    video.upscale?.status === "succeeded" && video.upscale.source
      ? [
          {
            id: `upscale:${video.requestId}:${video.upscale.taskId || video.upscale.target}`,
            source: video.upscale.source,
            label: `高清原片 · ${(video.upscale.target || "4k").toUpperCase()}`,
          },
        ]
      : []
  );
  const seen = new Set<string>();
  return [
    ...edited,
    ...effects,
    ...upscales,
    ...digitalHumanSegmentOutputs(draft),
  ].filter(clip => {
    if (seen.has(clip.source)) return false;
    seen.add(clip.source);
    return true;
  });
}
