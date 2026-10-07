import {it,expect} from 'vitest';
import {resolveManhuaStageAnimationSource} from './manhuaStageAnimationSource';
import {artMotionSpecSchema} from '../../shared/artMotion';
import {createManhuaPrevisStudio} from '../../shared/manhuaPrevis';
const studio=createManhuaPrevisStudio(2),jobId=`prv_${'c'.repeat(48)}`,worldTaskId='world-owned';
const spec=artMotionSpecSchema.parse({version:1,mode:'animation',grammar:'y5_kinetic_type',duration:2,width:720,height:1280,fps:24,cues:[],data:{},stageAnimation:{previsJobId:jobId,scopeId:studio.scopeId,clipId:'clip-owned',worldTaskId,sceneRef:'scene-owned',worldSourceVersion:'v-owned'}});
const request={requestId:crypto.randomUUID(),scopeId:studio.scopeId,clipId:'clip-owned',spec:{...studio.spec,aspect:'9:16',exportAnimation:true}};
const prefix='gs://bucket/post-prod/7/previs/request/';
const job={id:jobId,userId:'7',type:'post_prod',provider:'blender-previs',status:'succeeded',input:{action:'manhua_previs',params:request},output:{gcsUri:prefix+'preview.mp4',animation:{glbGcsUri:prefix+'animation.glb',framesGcsUri:prefix+'animation.frames.json',sha256:'a'.repeat(64),framesSha256:'b'.repeat(64)}}};
const world={taskId:worldTaskId,status:'succeeded',sceneRef:'scene-owned',sourceVersion:'v-owned',assets:{spz500kGcsUri:`gs://bucket/manhua-world/u7/${worldTaskId}/scene-500k.spz`}};
const deps=(j:any=job,w:any=world)=>({load:async()=>j,world:async()=>w,bucket:()=> 'bucket'});
it('native compositor refuses foreign model tasks, moved clip/scope/world versions and foreign world object prefixes',async()=>{
 await expect(resolveManhuaStageAnimationSource('7',spec,crypto.randomUUID(),deps())).resolves.toMatchObject({input:request,world});
 for(const changed of [{...job,userId:'8'},{...job,status:'running'},{...job,input:{action:'manhua_previs',params:{...request,clipId:'other'}}},{...job,input:{action:'manhua_previs',params:{...request,scopeId:crypto.randomUUID()}}}])
  await expect(resolveManhuaStageAnimationSource('7',spec,crypto.randomUUID(),deps(changed))).rejects.toThrow();
 for(const changed of [{...world,status:'running'},{...world,sourceVersion:'other'},{...world,sceneRef:'other'},{...world,assets:{spz500kGcsUri:`gs://bucket/manhua-world/u8/${worldTaskId}/scene-500k.spz`}}])
  await expect(resolveManhuaStageAnimationSource('7',spec,crypto.randomUUID(),deps(job,changed))).rejects.toThrow();
});
it('stage compilation cannot silently change native duration/aspect or mix Canvas-only data into 3D playback',async()=>{
 await expect(resolveManhuaStageAnimationSource('7',{...spec,duration:3},crypto.randomUUID(),deps())).rejects.toThrow();
 await expect(resolveManhuaStageAnimationSource('7',{...spec,width:1280,height:720},crypto.randomUUID(),deps())).rejects.toThrow();
 for(const extra of [{alpha:true},{fps:30},{cues:[{at:0,kind:'title',text:'fake'}]},{data:{scene:'empty canvas'}}])expect(artMotionSpecSchema.safeParse({...spec,...extra}).success).toBe(false);
});
