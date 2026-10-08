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
