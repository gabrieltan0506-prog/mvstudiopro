import {it,expect} from 'vitest';
import {adoptStageAnimationAsClip} from './manhuaStageAnimationAdoption';
import {defaultCanvasBlock} from './canvasTypes';
import {artMotionStateSchema,defaultArtMotionSpec} from '@shared/artMotion';
it('已回执场景动画进入原分段并保留旧片、音轨和任务身份，拒绝在途及错回执',()=>{
 const clip={...defaultCanvasBlock('video',0,0),id:'clip-1',outputUrl:'https://test.invalid/original.mp4',outputUrls:['https://test.invalid/older.mp4'],videoTaskId:'original-task',videoTaskStatus:'succeeded' as const};
 const spec={...defaultArtMotionSpec(),duration:2,cues:[],data:{},scenes:[],fps:24,width:720,height:1280,stageAnimation:{previsJobId:'prv_'+'a'.repeat(48),scopeId:crypto.randomUUID(),clipId:clip.id,worldTaskId:'mw-test',sceneRef:'scene-test',worldSourceVersion:'gs://test/scene.png'}};
 const output={url:'https://test.invalid/animation.mp4',gcsUri:'gs://test/animation.mp4'};
 const state=artMotionStateSchema.parse({version:1,spec,history:[],request:{id:crypto.randomUUID(),jobId:'job-animation',spec,status:'succeeded',gcsUri:output.gcsUri}});
 const next=adoptStageAnimationAsClip({...clip,lastFrameUrl:'https://test.invalid/old-tail.jpg',error:'旧任务错误'},state,output);
 expect(next.lastFrameUrl).toBeUndefined();expect(next.error).toBeUndefined();expect(next.manhuaClipQuality).toBeUndefined();
 expect(next.id).toBe(clip.id);expect(next.videoTaskId).toBe('original-task');expect(next.outputUrl).toBe(output.url);
 expect(next.outputUrls).toEqual([output.url,clip.outputUrl,...clip.outputUrls]);expect(clip.uploadedAssets).toEqual([]);
 expect(next.uploadedAssets.at(-1)?.gcsUri).toBe(output.gcsUri);
 for(const bad of [{...clip,id:'foreign'},{...clip,archivedFromPreviousScript:true},{...clip,status:'running' as const},{...clip,videoTaskStatus:'queued' as const}])expect(()=>adoptStageAnimationAsClip(bad,state,output)).toThrow();
 expect(()=>adoptStageAnimationAsClip(clip,state,{...output,gcsUri:'gs://test/foreign.mp4'})).toThrow();
 expect(()=>adoptStageAnimationAsClip(clip,{...state,request:{...state.request!,status:'running'}},output)).toThrow();
 for(const videoTaskStatus of ['timed_out_pending_reconcile','reconcile_manual'] as const)expect(()=>adoptStageAnimationAsClip({...clip,videoTaskStatus},state,output)).toThrow();
});
it('提交与采用拒绝已改变的配乐时间轴，保留旧单音轨兼容',async()=>{
 const {assertCurrentStageAnimationAudio}=await import('./manhuaStageAnimationAdoption');
 const {emptyCanvasAudioStudio,createCanvasAudioCue,canvasAudioCueInputKey}=await import('@shared/canvasAudioStudio');
 const {buildManhuaStageBgmAudio}=await import('@shared/manhuaPrevisAudio');
 const cue={...createCanvasAudioCue('bgm','配乐'),startSec:0,endSec:2,approved:true,selectedTakeId:'take'};
 cue.takes=[{id:'take',gcsUri:'gs://test/bgm.wav',previewUrl:'',createdAt:'test',durationSec:2,inputKey:canvasAudioCueInputKey(cue)}];
 const clip={...defaultCanvasBlock('video',0,0),audioStudio:{...emptyCanvasAudioStudio(),cues:[cue]}};
 const spec={...defaultArtMotionSpec(),duration:2,audioTimeline:buildManhuaStageBgmAudio(clip.audioStudio,2)};
 expect(()=>assertCurrentStageAnimationAudio(clip,spec)).not.toThrow();
 expect(()=>assertCurrentStageAnimationAudio(clip,{...spec,audioTimeline:undefined})).toThrow('已变化');
 expect(()=>assertCurrentStageAnimationAudio(clip,{...spec,audioTimeline:undefined,audioUri:'gs://test/old.wav'})).not.toThrow();
});
it('云草稿往返保留动画多裁片BGM及请求版本',async()=>{
 const {sanitizeManhuaCloudDraftBlock}=await import('@shared/manhuaCloudDraft');
 const spec={...defaultArtMotionSpec(),duration:2,cues:[],data:{},scenes:[],fps:24,stageAnimation:{previsJobId:'prv_'+'a'.repeat(48),scopeId:crypto.randomUUID(),clipId:'clip-1',worldTaskId:'mw-test',sceneRef:'s',worldSourceVersion:'gs://test/scene.png'},audioTimeline:{version:1 as const,startSec:4,durationSec:2,sourceKey:'adopted-bgm',dialogueCount:0,bgmCount:1,clips:[{audioUri:'gs://test/bgm.wav',sourceStartSec:4,sourceEndSec:6,startSec:0,volume:.4,fadeInSec:.1,fadeOutSec:.2}]}};
 const state=artMotionStateSchema.parse({version:1,spec,history:[],request:{id:crypto.randomUUID(),spec,status:'submitting'}});
 const result=sanitizeManhuaCloudDraftBlock(JSON.parse(JSON.stringify({...defaultCanvasBlock('video',0,0),artMotion:state})));
 expect(result?.artMotion).toEqual(state);
});
