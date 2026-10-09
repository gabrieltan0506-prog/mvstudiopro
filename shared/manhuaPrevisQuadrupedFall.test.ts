import { describe, expect, it } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema, manhuaPrevisStudioSchema } from "./manhuaPrevis";
import { previsPresentationGuideSpec } from "./manhuaPrevisPlayback";
import { formatPrevisMotionGuide } from "./manhuaPrevis";
import { quadrupedFallProgress, quadrupedFallMovementProgress } from "./manhuaPrevisQuadrupedFall";
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
 it("行进中屈腿减速，触地前停稳；恢复和变速不丢秒窗",()=>{
  const moving={...actor,end:[.8,0] as [number,number],moveStartSec:0,moveEndSec:2.5,quadrupedFall:{...fall,startSec:1,foldSec:2,groundSec:3}};
  const saved=manhuaPrevisStudioSchema.parse({...studio,spec:{...spec,actors:[moving]}});
  expect(saved.spec.actors[0]).toMatchObject(moving);
  const positions=Array.from({length:96},(_,i)=>quadrupedFallMovementProgress(moving,i/24));
  expect(positions[0]).toBe(0);expect(positions[60]).toBe(1);expect(positions[95]).toBe(1);
  const velocities=positions.slice(1).map((p,i)=>(p-positions[i])*24*.8);
  expect(Math.max(...velocities)).toBeLessThanOrEqual(1.2);
  expect(velocities.every(v=>v>=0)).toBe(true);
  expect(velocities.slice(24).every((v,i,all)=>i===0 || v<=all[i-1]+1e-8)).toBe(true);
  expect(velocities[59]).toBeLessThan(.002);
  const slow=previsPresentationGuideSpec({...saved.spec,timeMap:{sourceDurationSec:4,spans:[{sourceStartSec:0,sourceEndSec:4,rate:.5}]}});
  expect(slow.actors[0].moveEndSec).toBe(5);
  expect(slow.actors[0].quadrupedFall).toMatchObject({startSec:2,foldSec:4,groundSec:6});
  expect(formatPrevisMotionGuide(saved.spec)).toContain("2.5秒停止位移");
 });
 it.each([
  {moveEndSec:3.5},{moveEndSec:1},{moveStartSec:1},{moveStartSec:1/25},{end:[4,0]},
  {quadrupedFall:{mode:"hold",side:"right"}},
 ])("移动倒地拒绝触地后滑行、非行进起倒或超速 %j",patch=>{
  expect(manhuaPrevisSpecSchema.safeParse({...spec,actors:[{...actor,end:[.8,0],moveStartSec:0,moveEndSec:2.5,quadrupedFall:{...fall,startSec:1,foldSec:2,groundSec:3},...patch}]}).success).toBe(false);
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
