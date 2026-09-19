import { expect, it } from "vitest";
import { applyCanvasAudioMixPlan, assertCanvasAudioMixCapacity } from "./canvasAudioMixPlan";
import { canvasAudioMixSource, canvasAudioCueInputKey, createCanvasAudioCue, compileCanvasAudioBindings, emptyCanvasAudioStudio, getSelectedAudioTake, assertCanvasAudioMasterCurrent } from "./canvasAudioStudio";
import { sanitizeManhuaCloudDraftBlock } from "./manhuaCloudDraft";
import { normalizeManhuaSegmentReferenceEntry } from "./manhuaSegmentReference";
import { audioTimelineParamsSchema } from "../server/jobs/postProdInput";
const dialogue = { ...createCanvasAudioCue('dialogue','d'), startSec:1,endSec:3,approved:true,selectedTakeId:'d1',takes:[{id:'d1',gcsUri:'gs://test-bucket/d.wav',durationSec:2,previewUrl:'',createdAt:'test',inputKey:'test'}] };
const sound = { ...createCanvasAudioCue('sfx','s'),shotZh:'第4镜药碗落桌',startSec:0,endSec:6,approved:true,selectedTakeId:'s1',source:{gcsUri:'gs://test-bucket/source.wav',previewUrl:'',durationSec:6,labelZh:'药碗'},sourceEndSec:6,mix:{duckUnderDialogue:true,duckVolume:0.2,silenceWindows:[{startSec:4,endSec:5}]}};
sound.takes=[{id:'s1',gcsUri:'gs://test-bucket/trim.wav',durationSec:6,previewUrl:'https://test.invalid/trim.wav',createdAt:'test',inputKey:canvasAudioCueInputKey(sound)}];
const base={audioUri:sound.takes[0]!.gcsUri,sourceStartSec:0,sourceEndSec:6,startSec:0,volume:1,fadeInSec:0,fadeOutSec:0};
it("SFX同一长期身份及留白避让经过真实云草稿清洗、消费",()=>{
 const studio={...emptyCanvasAudioStudio(),cues:[sound]};
 const block=sanitizeManhuaCloudDraftBlock({id:'clip-e01-g01',kind:'video',x:0,y:0,width:420,height:360,prompt:'药碗',audioStudio:studio})!;
 expect(block.audioStudio!.cues[0]).toEqual(sound);
 const result=compileCanvasAudioBindings({studio:block.audioStudio,existingAudioUrls:[],durationSec:6});
 expect(result.audioUrls).toEqual([sound.takes[0]!.gcsUri]);expect(result.promptAppendix).toContain('<音效：@audio1');
 const master=normalizeManhuaSegmentReferenceEntry({url:'https://test.invalid/master.wav',audioStudioSource:canvasAudioMixSource([sound],6)})!;
 expect(()=>assertCanvasAudioMasterCurrent(master,studio,6)).not.toThrow();
 expect(()=>assertCanvasAudioMasterCurrent(master,{...studio,cues:[{...sound,mix:{...sound.mix,duckVolume:0.5}}]},6)).toThrow('旧版');
 expect(getSelectedAudioTake(sound)?.inputKey).toBe(canvasAudioCueInputKey({...sound,mix:{...sound.mix,duckVolume:0.5}}));
});
it("真实后期入参按对白实长避让、留白留空，不挪动来源时间",()=>{
 const clips=applyCanvasAudioMixPlan(sound,base,[sound,dialogue]);
 expect(clips.map(c=>[c.startSec,c.sourceStartSec,c.sourceEndSec,c.volume])).toEqual([[0,0,1,1],[1,1,3,0.2],[3,3,4,1],[5,5,6,1]]);
 expect(audioTimelineParamsSchema.parse({durationSec:6,clips}).clips).toEqual(clips);
 expect(()=>assertCanvasAudioMixCapacity(Array.from({length:13},()=>base))).toThrow('超过');
 expect(()=>applyCanvasAudioMixPlan({...sound,mix:{...sound.mix,silenceWindows:[{startSec:4,endSec:9}]}},base,[sound])).toThrow('时间窗');
});
