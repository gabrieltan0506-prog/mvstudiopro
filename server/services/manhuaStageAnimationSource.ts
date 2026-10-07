import {getJobByIdStrict} from '../jobs/repository';
import {readStageWorld} from './manhuaStageWorldBridge';
import {resolveManhuaPrevisMedia} from './manhuaPrevisMedia';
import {manhuaPrevisRequestSchema} from '../../shared/manhuaPrevis';
import {getGcsBucketName} from './gcs';
import type {ArtMotionSpec} from '../../shared/artMotion';
export async function resolveManhuaStageAnimationSource(userId:string,spec:ArtMotionSpec,requestId?:string,deps={load:getJobByIdStrict,world:readStageWorld,bucket:getGcsBucketName}) {
 const source=spec.stageAnimation;if(!source)throw new Error('缺少场景动画来源');
 const [job,world]=await Promise.all([deps.load(source.previsJobId),deps.world(userId,requestId,source.worldTaskId)]);
 const glb=resolveManhuaPrevisMedia(job,Number(userId),'animation'),frames=resolveManhuaPrevisMedia(job,Number(userId),'animation-frames');
 const input=manhuaPrevisRequestSchema.parse((job?.input as {params?:unknown})?.params);
 if(!glb || !frames || input.scopeId!==source.scopeId || input.clipId!==source.clipId || !input.spec.exportAnimation
   || input.spec.timeMap || input.spec.durationSec!==spec.duration || (input.spec.aspect==='9:16')!==(spec.height>spec.width))throw new Error('动作工程不属于本段或画幅片长已变化');
 if(!world || world.status!=='succeeded' || world.sceneRef!==source.sceneRef || world.sourceVersion!==source.worldSourceVersion
   || world.assets?.spz500kGcsUri!==`gs://${deps.bucket()}/manhua-world/u${userId}/${source.worldTaskId}/scene-500k.spz`)throw new Error('场景任务尚未完成或来源版本已变化');
 return {input,world,glb,frames,animation:(job!.output as {animation:{sha256:string;framesSha256:string}}).animation};
}
