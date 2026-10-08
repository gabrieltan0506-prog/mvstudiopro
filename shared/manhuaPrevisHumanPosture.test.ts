import { describe, expect, it } from "vitest";
import { humanPostureIssue, previsHumanPostureSchema } from "./manhuaPrevisHumanPosture";
const actor={shape:"human",start:[0,0],end:[0,0],actions:[{kind:"idle"}],humanPosture:previsHumanPostureSchema.parse({mode:"hold",posture:"recline",supportHeight:.45,reclineDeg:55})};
describe("基础人体持续坐卧",()=>{
  it("保留支撑高度和后仰，拒绝未知字段",()=>{
    expect(humanPostureIssue(actor,4)).toBeNull();
    expect(previsHumanPostureSchema.safeParse({...actor.humanPosture,vanishAfter:1}).success).toBe(false);
  });
  it("拒绝未验证真模与离场，坐起末帧前保持",()=>{
    expect(humanPostureIssue({...actor,riggedModel:{}},4)).toBeTruthy();
    expect(humanPostureIssue({...actor,visibleRanges:[]},4)).toBeTruthy();
    const humanPosture=previsHumanPostureSchema.parse({mode:"rise_to_sit",startSec:.5,endSec:2,supportHeight:.45,reclineDeg:55});
    expect(humanPostureIssue({...actor,humanPosture},4)).toBeNull();
    expect(humanPostureIssue({...actor,humanPosture:{...humanPosture,mode:"rise_to_sit",startSec:.5,endSec:4}},4)).toBeTruthy();
  });
});
