import { describe,it,expect } from "vitest";
import type { ManhuaPrevisRequest } from "../../shared/manhuaPrevis";
import { riggedPiggybackReportSchema,validateRiggedPiggybackReport } from "./manhuaPrevisRiggedPiggybackReport";

function fixture() {
  const models=["carrier","passenger"].map(actorId=>({actorId,sourceJobId:`m3d_${actorId}`,sha256:(actorId==="carrier"?"a":"b").repeat(64)}));
  const spec={actors:models.map(model=>({id:model.actorId,riggedModel:{sourceJobId:model.sourceJobId}})),piggyback:{carrierId:"carrier",passengerId:"passenger"}} as ManhuaPrevisRequest["spec"];
  const report={carrier:models[0],passenger:models[1],meshMeasured:true,normalSpeedValidated:false,boundaryZh:"测试数值，不是画面验收",
    samples:Array.from({length:48},(_,i)=>({frame:i+1,supportError:.001,gripError:.002,carrierSoleHeights:[0,.1],passengerSoleHeights:[.2,.25],maxBoneLengthError:0,blockAmount:0,blockError:0}))};
  const validate=(value:unknown)=>validateRiggedPiggybackReport(riggedPiggybackReportSchema.parse(value),spec,models,48);
  return {models,spec,report,validate};
}
describe("真实背负逐帧报告",()=>{
  it("双人来源和脚底条件闭合，并保留常速未验边界",()=>{
    const f=fixture();expect(()=>f.validate(f.report)).not.toThrow();
    expect(()=>f.validate({...f.report,normalSpeedValidated:true})).toThrow();
    expect(()=>validateRiggedPiggybackReport(undefined,f.spec,f.models,48)).toThrow("缺失");
  });
  it("拒绝换人、换模型与帧缺失，源人偶不能替代",()=>{
    const f=fixture();
    for(const patch of [{actorId:"another"},{sourceJobId:"m3d_old"},{sha256:"c".repeat(64)}])
      expect(()=>f.validate({...f.report,passenger:{...f.report.passenger,...patch}})).toThrow("来源");
    expect(()=>f.validate({...f.report,samples:f.report.samples.slice(1)})).toThrow();
    delete f.spec.actors[1].riggedModel;
    expect(()=>f.validate(f.report)).toThrow("来源");
  });
  it("拒绝载者全脚悬空、穿地、乘员落地、接触或骨长超差和伪造挡碗",()=>{
    const f=fixture();
    for(const patch of [{carrierSoleHeights:[.04,.1]},{carrierSoleHeights:[-.01,0]},{passengerSoleHeights:[0,.2]},
      {supportError:.006},{gripError:.006},{maxBoneLengthError:.002},{blockAmount:.2},{blockError:.001},{frame:2}]) {
      const report=structuredClone(f.report);Object.assign(report.samples[0],patch);
      expect(()=>f.validate(report)).toThrow();
    }
  });
});
