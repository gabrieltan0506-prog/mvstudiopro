import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";
import type { ManhuaVfxState } from "@shared/manhuaVfx";
import type { CanvasBlock } from "./canvasTypes";
import { getBlockEpisodeIndex } from "./canvasDramaStudio";

/** Project-local saved identities only. No media URLs, automatic inspection, or new tasks. */
export function buildAdvisorWorkflowEvidence(refs: ManhuaCustomAssetRef[], blocks: CanvasBlock[], vfx?: { scopeKey: string; episodeIndex: number; state: ManhuaVfxState }): string {
  const rows = ["当前作品已加载的保存记录；共享资产不等于某集已采用。带骨配置不证明GLB实际含骨/蒙皮；没有配置不能推断模型无骨。未列出的任务或集数未取得，不代表未做。"];
  for (const ref of refs) {
    rows.push(JSON.stringify({ assetId: ref.id, label: ref.labelZh, role: ref.role,
      model: ref.model3d ? { taskId: ref.model3d.taskId, status: ref.model3d.status } : undefined,
      world: ref.world3d ? { taskId: ref.world3d.taskId, status: ref.world3d.status } : undefined }));
  }
  for (const block of blocks) {
    const studio = block.previsStudio;
    if (!studio && !block.audioStudio && !block.artMotion) continue;
    const scope = { blockId: block.id, episodeIndex: getBlockEpisodeIndex(block) ?? "未标记", archived: Boolean(block.archivedFromPreviousScript) };
    if (studio) {
      rows.push(JSON.stringify({ ...scope, tool: "previs", selectedJobId: studio.selectedJobId || null,
        pendingRequestId: studio.pending?.requestId,
        currentActors: studio.spec.actors.map(a => ({ id: a.id, name: a.nameZh, assetId: a.assetRef, shape: a.shape, modelTaskId: a.riggedModel?.sourceJobId, rigKind: a.riggedModel?.rigKind || (a.riggedModel ? "human" : undefined) })) }));
      for (const take of studio.history) rows.push(JSON.stringify({ ...scope, tool: "previs_saved_take", jobId: take.jobId, requestId: take.requestId, selected: studio.selectedJobId === take.jobId,
        actors: take.spec.actors.map(a => ({ name: a.nameZh, assetId: a.assetRef, shape: a.shape, modelTaskId: a.riggedModel?.sourceJobId, rigKind: a.riggedModel?.rigKind || (a.riggedModel ? "human" : undefined) })) }));
    }
    if (block.audioStudio) rows.push(JSON.stringify({ ...scope, tool: "audio", adoptedCues: block.audioStudio.cues.filter(c => c.enabled && c.approved).map(c => ({ id: c.id, selectedTakeId: c.selectedTakeId })) }));
    if (block.artMotion) {
      const state = block.artMotion;
      rows.push(JSON.stringify({ ...scope, tool: "art_motion", requestId: state.request?.id, jobId: state.request?.jobId, status: state.request?.status,
        savedOutput: Boolean(state.request?.gcsUri), adopted: "未提供采用记录",
        history: state.history.map(r => ({ requestId: r.id, jobId: r.jobId, status: r.status, savedOutput: Boolean(r.gcsUri) })) }));
    }
  }
  if (vfx && vfx.scopeKey && vfx.state.scopeKey === vfx.scopeKey) {
    rows.push(JSON.stringify({ tool: "vfx", episodeIndex: vfx.episodeIndex, scopeKey: vfx.scopeKey, adoptedRequestId: vfx.state.adoptedRequestId || null,
      requests: Object.values(vfx.state.requests).map(r => ({ requestId: r.requestId, jobId: r.jobId, status: r.status, sourceBlockId: r.sourceId,
        effectKinds: r.composition.effects.map(e => e.kind), savedOutput: Boolean(r.output), adopted: r.requestId === vfx.state.adoptedRequestId })) }));
  }
  return rows.join("\n");
}
