import { describe,it,expect } from "vitest";
import { validatePrevisReport } from "./manhuaPrevisReport";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema } from "../../shared/manhuaPrevis";
import { quadrupedFallReportSchema,validateQuadrupedFallReport } from "./manhuaPrevisQuadrupedFallReport";
const base=createManhuaPrevisStudio(2,"11111111-1111-4111-8111-111111111111").spec;
const spec=manhuaPrevisSpecSchema.parse({...base,actors:[{...base.actors[0],shape:"horse",start:[0,0],end:[0,0],facingDeg:0,actions:[],quadrupedFall:{mode:"hold",side:"left"}}]});
const makeReport=()=>quadrupedFallReportSchema.parse([{actorId:spec.actors[0].id,rootSource:{kind:"sourceRig"},torsoVertices:8,meshMeasured:true,normalSpeedValidated:false,samples:Array.from({length:48},(_,i)=>({frame:i+1,held:true,minimumHeight:0,torsoMinimumHeight:0,torsoTiltDeg:90,torsoUp:[0,1,0],legFoldDeg:[120,120,120,120],root:[0,0,.2]}))}]);
describe("倒地回执来源与实际测量门禁",()=>{
 it("统一生产与恢复门禁实际消费倒地回执",()=>{
  const report={frames:48,fps:24,warnings:[],actors:spec.actors.map(a=>({id:a.id,nameZh:a.nameZh,bones:15,contactError:0,stanceDrift:0,offscreenFrames:[]})),quadrupedFalls:makeReport()};
  expect(validatePrevisReport(report,spec).quadrupedFalls).toEqual(report.quadrupedFalls);
  const {quadrupedFalls:_,...missing}=report;
  expect(()=>validatePrevisReport(missing,spec)).toThrow("倒地逐帧报告数量或身份不一致");
 });
 it("接受完整结构，但仍明确常速未验",()=>expect(()=>validateQuadrupedFallReport(makeReport(),spec)).not.toThrow());
 it.each(["missing","torso","legs","side","drift","held","frame"])("拒绝 %s 损坏回执",kind=>{
  const report=makeReport();const row=report[0].samples[47];
  if(kind==="missing") report[0].samples.pop();
  if(kind==="torso") row.torsoMinimumHeight=.2;
  if(kind==="legs") row.legFoldDeg[2]=20;
  if(kind==="side") row.torsoUp=[0,-1,0];
  if(kind==="drift") row.root[2]+=.1;
  if(kind==="held") row.held=false;
  if(kind==="frame") row.frame=47;
  expect(()=>validateQuadrupedFallReport(report,spec)).toThrow(/倒地/);
 });
 it("真实模型不能冒用sourceRig测量",()=>{
  const withModel={...spec,actors:[{...spec.actors[0],riggedModel:{sourceJobId:"actual-model"}}]};
  expect(()=>validateQuadrupedFallReport(makeReport(),withModel as typeof spec)).toThrow("倒地报告未读取本角色实际带骨网格");
 });
 it("没有倒地动作不能夹入回执",()=>expect(()=>validateQuadrupedFallReport(makeReport(),base)).toThrow("倒地逐帧报告数量或身份不一致"));
});
