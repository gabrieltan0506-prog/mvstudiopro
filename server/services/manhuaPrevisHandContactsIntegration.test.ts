import { expect,it } from "vitest";
import { createManhuaPrevisStudio,manhuaPrevisSpecSchema,manhuaPrevisStudioSchema,formatPrevisMotionGuide } from "../../shared/manhuaPrevis";
import { makeAdvisorPrevisTarget,advisorPrevisPatchSchema,applyAdvisorPrevisCandidate,prepareAdvisorPrevisTrial,prepareAdvisorPrevisComparison } from "../../shared/manhuaAdvisorPrevisEdit";
import { previsPresentationGuideSpec } from "../../shared/manhuaPrevisPlayback";
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
it("扶坐候选保留真实模型，独立试看及确认草稿恢复不丢双手窗口",()=>{
 const studio=createManhuaPrevisStudio(2);
 const actor=studio.spec.actors[0];
 studio.spec=manhuaPrevisSpecSchema.parse({...studio.spec,actors:[
  {...actor,id:"girl",assetRef:"test-girl",riggedModel:{sourceJobId:"m3d_test_girl",forwardAxis:"+X",targetHeight:1.7}},
  {...actor,id:"mom",assetRef:"test-mom",riggedModel:{sourceJobId:"m3d_test_mom",forwardAxis:"+X",targetHeight:1.6},humanPosture:{mode:"rise_to_sit",startSec:.5,endSec:1.5,supportHeight:.45,reclineDeg:45}},
 ]});
 const before=JSON.stringify(studio);
 const candidate={target:makeAdvisorPrevisTarget("clip-test",studio),patch:advisorPrevisPatchSchema.parse({kind:"previs_edit_v1",summaryZh:"双手扶住上臂完成坐起",unsupportedZh:[],handContacts:["-1","1"].map(side=>({id:`support${side}`,actorId:"girl",hand:`hand${side}`,targetActorId:"mom",bone:`upper_arm${side}`,startSec:0,contactSec:.5,releaseSec:1.5,endSec:2}))})};
 expect(candidate.target.specJson).toContain('"hasRiggedModel":true');
 expect(candidate.target.specJson).not.toContain("m3d_test");
 const comparison=prepareAdvisorPrevisComparison(candidate);
 expect(comparison.after.handContacts).toHaveLength(2);
 expect(comparison.after.actors.every(a=>!a.riggedModel&&!a.assetRef)).toBe(true);
 expect(comparison.afterContextJson).toContain('"hasRiggedModel":true');
 expect(JSON.stringify(comparison)).not.toContain("CONTEXT_VALIDATION_ONLY");
 const trial=prepareAdvisorPrevisTrial("clip-test",studio,candidate);
 expect(trial.request.scopeId).not.toBe(studio.scopeId);
 expect(trial.request.spec.actors.map(a=>a.riggedModel?.sourceJobId)).toEqual(["m3d_test_girl","m3d_test_mom"]);
 expect(JSON.stringify(studio)).toBe(before);
 const restored=manhuaPrevisStudioSchema.parse(JSON.parse(JSON.stringify(applyAdvisorPrevisCandidate("clip-test",studio,candidate))));
 expect(restored.spec.handContacts).toEqual(trial.request.spec.handContacts);
 expect(restored.specHistory?.at(-1)?.spec).toEqual(studio.spec);
 expect(previsPresentationGuideSpec(restored.spec).handContacts).toEqual(restored.spec.handContacts);
 expect(formatPrevisMotionGuide(restored.spec)).toContain("上臂表面");
 expect(()=>makeAdvisorPrevisTarget("clip-test",restored)).not.toThrow();
});
