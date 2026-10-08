import { expect,it } from "vitest";
import { createManhuaPrevisStudio,manhuaPrevisSpecSchema,manhuaPrevisStudioSchema } from "../../shared/manhuaPrevis";
import { PREVIS_BODY_BONES, PREVIS_QUADRUPED_SOURCE_BONES } from "../../shared/manhuaPrevisRig";
import { validatePrevisReport } from "./manhuaPrevisReport";
it("扶颈经正式spec和云草稿保存，总报告拒绝漏掉真实接触回执",()=>{
 const studio=createManhuaPrevisStudio(2,"11111111-1111-4111-8111-111111111111");
 const actor=studio.spec.actors[0];
 studio.spec=manhuaPrevisSpecSchema.parse({...studio.spec,actors:[actor,{...actor,id:"horse",shape:"horse"}],handContacts:[{id:"touch",actorId:actor.id,hand:"hand1",targetActorId:"horse",bone:"neck",startSec:0,contactSec:.5,releaseSec:1.5,endSec:2}]});
 const restored=manhuaPrevisStudioSchema.parse(JSON.parse(JSON.stringify(studio)));
 expect(restored.spec.handContacts).toEqual(studio.spec.handContacts);
 const report={frames:48,fps:24,warnings:[],actors:restored.spec.actors.map(a=>({id:a.id,nameZh:a.nameZh,bones:a.shape==="horse"?new Set(Object.values(PREVIS_QUADRUPED_SOURCE_BONES)).size:PREVIS_BODY_BONES.length,contactError:0,stanceDrift:0,offscreenFrames:[]}))};
 expect(()=>validatePrevisReport(report,restored.spec)).toThrow(/人马接触/);
});
