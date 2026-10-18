import type { DigitalHumanDraft } from "@shared/digitalHumanStudio";
import { digitalHumanSegmentOutputs } from "@shared/digitalHumanProject";
import { buildPostProdClipOptions, jobsStorageKey, normalizeStoredJobs, postProdJobMatchesScope, mergeClipOptions } from "./postProdWorkshop";
import { adoptedManhuaVfxClipOptions } from "./manhuaVfxWorkflow";
import { digitalHumanPostProdMedia, readDigitalHumanVfx } from "./digitalHumanPostProd";

/** 同一段保存的后期回执进入整片；特效必须显式采用且仍绑定原片。 */
export function digitalHumanProjectSegmentOutputs(draft: DigitalHumanDraft) {
  const scope = `digital-human:${draft.id}`;
  const parse = (key: string): unknown => { try { return JSON.parse(draft.postProdStorage[key] || "[]"); } catch { return []; } };
  const jobs = normalizeStoredJobs(parse(jobsStorageKey(draft.owner)), Number.POSITIVE_INFINITY).filter(job => postProdJobMatchesScope(job, scope));
  const edited = buildPostProdClipOptions(jobs);
  const rawUpscales = parse(`postProd.upscale.v1.u${draft.owner}`);
  const enhanced = Array.isArray(rawUpscales) ? rawUpscales.flatMap(row => row && row.scopeKey === scope && row.status === "succeeded" && typeof row.taskId === "string" && typeof row.videoUrl === "string" && /^(gs:\/\/|https:\/\/)/.test(row.videoUrl)
    ? [{ id: `upscale:${row.taskId}`, url: row.videoUrl, label: `${String(row.target).toUpperCase()} 高清版 · ${row.sourceLabel || "后期成片"}` }] : []) : [];
  const sources = mergeClipOptions([...enhanced, ...edited], digitalHumanPostProdMedia(draft).clips);
  let effects: ReturnType<typeof adoptedManhuaVfxClipOptions> = [];
  try { effects = adoptedManhuaVfxClipOptions(readDigitalHumanVfx(draft.postProdStorage, scope), scope, sources); }
  catch { /* 损坏记录不作为已审特效，工作台会显示错误；原数据保留。 */ }
  const seen = new Set<string>();
  return [...effects, ...sources].map(c => ({ id: c.id, source: c.url, label: c.label }))
    .concat(digitalHumanSegmentOutputs(draft)).filter(clip => {
      if (seen.has(clip.source)) return false;
      seen.add(clip.source); return true;
    });
}
