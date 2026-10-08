import { it, expect } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema, manhuaPrevisStudioSchema } from "../../shared/manhuaPrevis";
import { validatePrevisReport } from "./manhuaPrevisReport";
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
