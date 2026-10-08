import {it,expect} from 'vitest';
import {requireCurrentStageAnimation} from './manhuaStageAnimationBinding';
import {createManhuaPrevisStudio} from '@shared/manhuaPrevis';
import {defaultCanvasBlock} from './canvasTypes';
const studio=createManhuaPrevisStudio(2),jobId='prv_'+ 'c'.repeat(48);
const animation={glbUrl:`/api/manhua-previs-media/${jobId}/animation`,framesUrl:`/api/manhua-previs-media/${jobId}/animation-frames`,sha256:'a'.repeat(64),framesSha256:'b'.repeat(64)};
const source={previsJobId:jobId,scopeId:studio.scopeId,clipId:'clip-owned',worldTaskId:'mw-owned',sceneRef:'scene-owned',worldSourceVersion:'gs://bucket/image.png'};
const clip={...defaultCanvasBlock('video',0,0),id:source.clipId,episodeIndex:2,previsStudio:{...studio,selectedJobId:jobId,history:[{jobId,requestId:crypto.randomUUID(),spec:studio.spec,animation}]}};
const ref:any={id:source.sceneRef,role:'scene',url:'https://example.com/image.png',gcsUri:source.worldSourceVersion,reviewStatus:"accepted",world3d:{taskId:source.worldTaskId,status:'succeeded',sourceVersion:source.worldSourceVersion}};
it('adoption requires the currently selected take, unchanged clip motion and current owned scene image/version',()=>{
 expect(requireCurrentStageAnimation([clip] as any,[ref],source).episodeIndex).toBe(2);
 for(const change of [{...clip,id:'other'},{...clip,archivedFromPreviousScript:true},{...clip,previsStudio:{...clip.previsStudio,scopeId:crypto.randomUUID()}},{...clip,previsStudio:{...clip.previsStudio,selectedJobId:'other'}},{...clip,previsStudio:{...clip.previsStudio,spec:{...studio.spec,durationSec:3}}}])expect(()=>requireCurrentStageAnimation([change] as any,[ref],source)).toThrow();
 for(const change of [{...ref,id:'other'},{...ref,gcsUri:'gs://bucket/changed.png'},{...ref,world3d:{...ref.world3d,taskId:'mw-other'}},{...ref,world3d:{...ref.world3d,status:'running'}}])expect(()=>requireCurrentStageAnimation([clip] as any,[change],source)).toThrow();
});

it('已采用顾问独立试看使用真实来源scope，仍拒绝其他scope',()=>{
 const trialScope=crypto.randomUUID();
 const trialClip={...clip,previsStudio:{...clip.previsStudio,history:clip.previsStudio.history.map(t=>({...t,sourceScopeId:trialScope}))}};
 expect(requireCurrentStageAnimation([trialClip] as any,[ref],{...source,scopeId:trialScope})).toBe(trialClip);
 expect(()=>requireCurrentStageAnimation([trialClip] as any,[ref],source)).toThrow();
});
