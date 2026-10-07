import { describe, expect, it } from "vitest";
import { autoRigRequestSchema, autoRigJointLabel, AUTO_RIG_JOINTS } from "@shared/manhuaAutoRig";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema } from "@shared/manhuaPrevis";
import { applyRigForm, createRigForm } from "./manhuaPrevisRigForm";
import { collectPreparedRigProfiles } from "./manhuaPrevisProfiles";
import type { CanvasBlock } from "./canvasTypes";

const source = "m3d_horse_original";
const settings = {pose:"quadruped" as const,forwardAxis:"+X" as const,targetHeight:1.9};
const request = {stage:"bind" as const,requestId:"bc9353c9-833e-471e-b4ab-a4c75da112cb",assetRef:"horse",sourceJobId:source,settings,inspectionRequestId:"64bb95db-4daf-4167-8442-fef5cc5ebdc1",sourceDigest:"a".repeat(64),joints:Object.fromEntries(AUTO_RIG_JOINTS.map(key=>[key,[0,0,1]])),singleHuman:false,singleQuadruped:true,landmarksManuallyConfirmed:true};
const rig = {rigKind:"quadruped" as const,sourceJobId:source,forwardAxis:"+X" as const,targetHeight:1.9};
function spec() {
  const s=createManhuaPrevisStudio(4).spec;
  Object.assign(s.actors[0],{assetRef:"horse",shape:"horse",riggedModel:{...rig},actions:[{kind:"idle",startSec:0,endSec:4}]});
  return s;
}
describe("quadruped rig contract",()=>{
  it("accepts explicit single quadruped confirmation and rejects a fabricated human confirmation",()=>{
    expect(autoRigRequestSchema.safeParse(request).success).toBe(true);
    expect(autoRigRequestSchema.safeParse({...request,singleHuman:true}).success).toBe(false);
    expect(autoRigRequestSchema.safeParse({...request,singleQuadruped:undefined}).success).toBe(false);
    expect(autoRigRequestSchema.safeParse({...request,settings:{...settings,pose:"T"}}).success).toBe(false);
  });
  it("uses front/hind limb labels, preserving all serialized joint slots",()=>{
    expect(autoRigJointLabel("elbowL","quadruped")).toBe("左前膝");
    expect(autoRigJointLabel("kneeL","quadruped")).toBe("左后膝");
    expect(autoRigJointLabel("elbowL","T")).toBe("左肘");
  });
  it("requires the rig kind to match the actor shape",()=>{
    expect(manhuaPrevisSpecSchema.safeParse(spec()).success).toBe(true);
    const s=spec();s.actors[0].shape="human";
    expect(manhuaPrevisSpecSchema.safeParse(s).success).toBe(false);
    const horse=spec();delete horse.actors[0].riggedModel!.rigKind;
    expect(manhuaPrevisSpecSchema.safeParse(horse).success).toBe(false);
  });
  it("applies a horse rig without human facial controllers and keeps source identity",()=>{
    const form={...createRigForm(undefined,source),enabled:true};
    expect(applyRigForm(form,{taskId:source,durationSec:4,shape:"horse"})).toMatchObject({rigKind:"quadruped",sourceJobId:source});
    expect(()=>applyRigForm({...form,performanceEnabled:true},{taskId:source,durationSec:4,shape:"horse"})).toThrow("人体眼骨");
  });
  it("preserves quadruped kind in saved reusable profiles",()=>{
    const studio=createManhuaPrevisStudio(4);studio.spec=spec();
    const profiles=collectPreparedRigProfiles([{id:"segment",previsStudio:studio} as CanvasBlock],[{id:"horse",label:"墨屠",model:{taskId:source}}]);
    expect(profiles).toHaveLength(1);expect(profiles[0].riggedModel.rigKind).toBe("quadruped");
  });
});
