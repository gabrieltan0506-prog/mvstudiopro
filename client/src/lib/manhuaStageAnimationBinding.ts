import type {ArtMotionSpec} from '@shared/artMotion';
import type {ManhuaCustomAssetRef} from '@shared/manhuaCustomAssetRefs';
import {evaluateManhuaWorld3dEligibility} from '@shared/manhuaWorld3d';
import type {CanvasBlock} from './canvasTypes';
/** New submissions/adoption use current project data; querying old tasks remains allowed. */
export function requireCurrentStageAnimation(blocks:CanvasBlock[],refs:ManhuaCustomAssetRef[],source:NonNullable<ArtMotionSpec['stageAnimation']>) {
 const clip=blocks.find(b=>b.id===source.clipId),studio=clip?.previsStudio;
 const take=studio?.history.find(t=>t.jobId===source.previsJobId);
 const ref=refs.find(r=>r.id===source.sceneRef);
 const world=ref?evaluateManhuaWorld3dEligibility(ref).currentWorld3d:undefined;
 if(!clip || clip.archivedFromPreviousScript || !studio || (take?.sourceScopeId ?? studio.scopeId)!==source.scopeId || studio.selectedJobId!==source.previsJobId || !take?.animation
   || JSON.stringify(take.spec)!==JSON.stringify(studio.spec) || world?.status!=='succeeded'
   || world.taskId!==source.worldTaskId || world.sourceVersion!==source.worldSourceVersion)
  throw new Error('本段动作或场景已变化，原任务与候选保留，未提交或采用到当前作品');
 return clip;
}
