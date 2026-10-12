import { it, expect } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema, manhuaPrevisStudioSchema } from "../../shared/manhuaPrevis";
import { validatePrevisReport } from "./manhuaPrevisReport";
import { applyAdvisorPrevisCandidate, makeAdvisorPrevisTarget } from "../../shared/manhuaAdvisorPrevisEdit";
import { sanitizeManhuaCloudDraftBlock } from "../../shared/manhuaCloudDraft";
it("持针候选经正式采用及云草稿恢复保留模型与释放窗",()=>{
 const studio=createManhuaPrevisStudio(2,"11111111-1111-4111-8111-111111111111");
 const actor=studio.spec.actors[0];
 actor.assetRef="test-doctor";
 actor.riggedModel={sourceJobId:"m3d_test_doctor",forwardAxis:"-Y",targetHeight:1.7};
 const next=applyAdvisorPrevisCandidate("test-clip",studio,{target:makeAdvisorPrevisTarget("test-clip",studio),patch:{
  kind:"previs_edit_v1",summaryZh:"独立取针轨迹驱动手腕",unsupportedZh:[],storyProps:[{
   id:"needle-take",kind:"needle",grip:{actorId:actor.id,hand:"hand1",offset:[0,0,0],startSec:0,endSec:1},
   keyframes:[{timeSec:0,anchor:{type:"world",position:[.4,0,1.15]},visible:true,scale:1,rotation:[0,0,0],fill:0},{timeSec:2,anchor:{type:"world",position:[.4,0,1.4]},visible:true,scale:1,rotation:[0,0,0],fill:0}],
  }],
 }});
 const restored=sanitizeManhuaCloudDraftBlock(JSON.parse(JSON.stringify({id:"test-clip",kind:"video",previsStudio:next})))!.previsStudio!;
 expect(restored.spec.storyProps).toEqual(next.spec.storyProps);
 expect(restored.spec.actors[0].riggedModel).toEqual(actor.riggedModel);
 expect(restored.specHistory?.at(-1)?.spec).toEqual(studio.spec);
 expect(studio.spec.storyProps).toBeUndefined();
});
it("剧情道具经spec/云草稿保留，生产总报告拒绝漏掉道具",()=>{
 const studio=createManhuaPrevisStudio(2,"11111111-1111-4111-8111-111111111111");
 const actor=studio.spec.actors[0];
 const anchor={type:"bone",actorId:actor.id,bone:"hand1"};
 studio.spec=manhuaPrevisSpecSchema.parse({...studio.spec,storyProps:[{id:"blood-bowl",kind:"bowl",grip:{actorId:actor.id,hand:"hand1"},keyframes:[{timeSec:0,anchor},{timeSec:2,anchor}]}]});
 const restored=manhuaPrevisStudioSchema.parse(JSON.parse(JSON.stringify(studio)));
 expect(restored.spec.storyProps).toEqual(studio.spec.storyProps);
 const report={frames:48,fps:24,warnings:[],actors:[{id:actor.id,nameZh:actor.nameZh,bones:16,contactError:0,stanceDrift:0,offscreenFrames:[]}]};
 expect(()=>validatePrevisReport(report,restored.spec)).toThrow(/剧情道具/);
});
