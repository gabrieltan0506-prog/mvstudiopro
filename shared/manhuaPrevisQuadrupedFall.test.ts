import { describe, expect, it } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema, manhuaPrevisStudioSchema } from "./manhuaPrevis";
import { previsPresentationGuideSpec } from "./manhuaPrevisPlayback";
import { formatPrevisMotionGuide } from "./manhuaPrevis";
import { quadrupedFallProgress } from "./manhuaPrevisQuadrupedFall";
const studio=createManhuaPrevisStudio(4,"11111111-1111-4111-8111-111111111111");
const fall={mode:"collapse" as const,side:"right" as const,startSec:0,foldSec:1,groundSec:2};
const actor={...studio.spec.actors[0],shape:"horse" as const,start:[0,0] as [number,number],end:[0,0] as [number,number],actions:[],quadrupedFall:fall};
const spec={...studio.spec,actors:[actor]};
describe("四足倒地生产配置",()=>{
 it("严格schema和云草稿保留collapse与后续hold",()=>{
  expect(manhuaPrevisSpecSchema.parse(spec).actors[0].quadrupedFall).toEqual(fall);
  const held={...spec,actors:[{...actor,quadrupedFall:{mode:"hold" as const,side:"right" as const}}]};
  expect(manhuaPrevisStudioSchema.parse({...studio,spec:held}).spec.actors[0].quadrupedFall).toEqual({mode:"hold",side:"right"});
  expect(quadrupedFallProgress(fall,3)).toEqual(quadrupedFallProgress(held.actors[0].quadrupedFall,0));
 });
 it("呈现文案与变速后的倒地秒窗一致",()=>{
  const source=manhuaPrevisSpecSchema.parse({...spec,timeMap:{sourceDurationSec:4,spans:[{sourceStartSec:0,sourceEndSec:4,rate:.5}]}});
  expect(previsPresentationGuideSpec(source).actors[0].quadrupedFall).toEqual({...fall,foldSec:2,groundSec:4});
  expect(formatPrevisMotionGuide(source)).toContain("4秒躯干触地并保持至片尾");
 });
 it.each([
  {quadrupedFall:{...fall,groundSec:4}},
  {quadrupedFall:{...fall,foldSec:.1}},
  {quadrupedFall:{...fall,startSec:1/25}},
  {shape:"human"}, {end:[1,0]},
  {actions:[{kind:"limp_front_left",startSec:0,endSec:4}]},
  {visibleRanges:[{startSec:0,endSec:4}]},
 ])("拒绝时序与动作叠加 %j",patch=>{
  const result=manhuaPrevisSpecSchema.safeParse({...spec,actors:[{...actor,...patch}]});
  expect(result.success).toBe(false);
  if(!result.success) expect(result.error.issues.some(issue=>issue.path.includes("quadrupedFall"))).toBe(true);
 });
});
