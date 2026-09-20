import {it,expect,vi} from 'vitest';
import {buildManhuaCloudDraftPayload,parseManhuaCloudDraftPayload} from '@shared/manhuaCloudDraft';
import {defaultCanvasBlock} from './canvasTypes';
import {cloudDraftBlocksToCanvas} from './manhuaCloudDraftSync';
import {previewCanvasBlockOutbound} from './canvasRunBlock';
import {groupShotsIntoSegments, type ManhuaWorkbenchShot} from '@shared/manhuaScriptWorkbench';
import {buildManhuaAutoSegmentBinding} from '@shared/manhuaAutoSegment';
import {compilePrevisScriptDraft} from '@shared/manhuaPrevisScript';
import {createManhuaPrevisStudio,manhuaPrevisSpecSchema,formatPrevisMotionGuide} from '@shared/manhuaPrevis';
import {manhuaGeneratedPrevisCoverageIssue} from '@shared/manhuaPrevisScope';
const model='seedance-2.0-mini';
function fixture(duration=18){
 const segments=groupShotsIntoSegments([{index:1,durationSec:duration,actionZh:'阿菁抬臂保护。',cameraZh:'固定',sceneZh:'庭院'} as ManhuaWorkbenchShot],{videoModel:model});
 const segment=segments[0];
 const studio=createManhuaPrevisStudio(segment.durationSec);
 const draft=compilePrevisScriptDraft({shots:segment.shots.map(s=>({index:s.index,durationSec:s.durationSec,actionZh:s.actionZh})),characters:[{id:'qing',label:'阿菁'}],currentSpec:studio.spec});
 expect(draft.errors).toEqual([]);expect(draft.spec).toBeTruthy();
 const spec=manhuaPrevisSpecSchema.parse(JSON.parse(JSON.stringify(draft.spec)));
 const take={gcsUri:'gs://offline/previs.mp4',jobId:'local',requestId:'22222222-2222-4222-8222-222222222222',url:'https://test.invalid/previs.mp4',durationSec:segment.durationSec,createdAt:'2026-09-20',spec};
 studio.history=[take];
 const reference={url:take.url,durationSec:take.durationSec,updatedAt:take.createdAt,motionGuideZh:formatPrevisMotionGuide(spec)};
 return {segments,studio,reference};
}
it('同镜同秒两窗口的历史来源相同，必须拒绝未知镜内来源',()=>{
 const f=fixture();expect(f.segments).toHaveLength(2);
 expect(f.segments.map(s=>s.shots[0].sourceOffsetSec)).toEqual([0,9]);
 expect(f.segments.map(s=>s.durationSec)).toEqual([9,9]);
 for(const s of f.segments){expect(manhuaGeneratedPrevisCoverageIssue({reference:f.reference,studio:f.studio,durationSec:s.durationSec,shotIndexes:[1],autoSegment:buildManhuaAutoSegmentBinding(1,s,model)})).toMatch(/镜内|窗口/);}
});
it('普通完整镜及旧无窗口草稿继续兼容，手动短参考不套用',()=>{
 const f=fixture(5),s=f.segments[0];
 expect(manhuaGeneratedPrevisCoverageIssue({reference:f.reference,studio:f.studio,durationSec:s.durationSec,shotIndexes:[1],autoSegment:buildManhuaAutoSegmentBinding(1,s,model)})).toBeUndefined();
 expect(manhuaGeneratedPrevisCoverageIssue({reference:f.reference,studio:f.studio,durationSec:s.durationSec,shotIndexes:[1]})).toBeUndefined();
 const long=fixture();expect(manhuaGeneratedPrevisCoverageIssue({reference:{url:'https://test.invalid/manual.mp4',durationSec:2,updatedAt:'2026-09-20'},studio:long.studio,durationSec:9,shotIndexes:[1],autoSegment:buildManhuaAutoSegmentBinding(1,long.segments[1],model)})).toBeUndefined();
});

it('旧云草稿恢复后实际视频出站拒绝同镜错窗，旧参考和候选不变',async()=>{
 const f=fixture();
 const block={...defaultCanvasBlock('video',0,0),id:'clip-e01-g02-auto-test',videoModel:model as 'seedance-2.0-mini',prompt:'【第2段·9s】阿菁抬臂保护。',previsStudio:f.studio,manhuaAutoSegment:buildManhuaAutoSegmentBinding(1,f.segments[1],model),manhuaSegmentRefs:{previs:f.reference}};
 const snapshot=parseManhuaCloudDraftPayload(JSON.stringify(buildManhuaCloudDraftPayload({writerSession:{},blocks:[block],edges:[]})))!;
 const restored=cloudDraftBlocksToCanvas(snapshot.canvas.blocks,{videoModel:model})[0];
 expect(restored.previsStudio!.history[0].spec.scriptSource).toEqual(f.studio.history[0].spec.scriptSource);
 const before=JSON.stringify(restored);
 const noNetwork=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('离线探针禁止网络'));
 try{
  await expect(previewCanvasBlockOutbound({userRole:'admin',userId:'offline-test',optimizeCopy:async()=>''},restored)).rejects.toThrow(/镜内窗口/);
  expect(noNetwork).not.toHaveBeenCalled();expect(JSON.stringify(restored)).toBe(before);
 }finally{noNetwork.mockRestore();}
});
