import { describe,it,expect } from "vitest";
import {createManhuaPrevisStudio,manhuaPrevisSpecSchema,manhuaPrevisStudioSchema} from "../../shared/manhuaPrevis";
import {previsPresentationGuideSpec} from "../../shared/manhuaPrevisPlayback";
import {formatPrevisMotionGuide} from "../../shared/manhuaPrevis";
import {piggybackBlockAmount} from "../../shared/manhuaPrevisPiggyback";
import {validatePrevisReport} from "./manhuaPrevisReport";
function fixture(){
 const studio=createManhuaPrevisStudio(3,"11111111-1111-4111-8111-111111111111");
 const actor={...studio.spec.actors[0],start:[0,0],end:[0,0],actions:[]};
 const anchor={type:"bone",actorId:"holder",bone:"hand-1",along:1,offset:[0,0,0]};
 const spec=manhuaPrevisSpecSchema.parse({...studio.spec,
 actors:[{...actor,id:"carrier"},{...actor,id:"passenger"},{...actor,id:"holder",start:[.5,0],end:[.5,0]}],
 piggyback:{carrierId:"carrier",passengerId:"passenger",blockBowl:{hand:"hand-1",bowlId:"bowl",startSec:0,contactSec:.5,releaseSec:1.5,endSec:2.5,offset:[0,-.16,0]}},
 storyProps:[{id:"bowl",kind:"bowl",grip:{actorId:"holder",hand:"hand-1",offset:[0,0,-.02]},keyframes:[{timeSec:0,anchor},{timeSec:3,anchor}]}]});
 const prop=spec.storyProps![0];
 const report={frames:72,fps:24,warnings:[],actors:spec.actors.map(a=>({id:a.id,nameZh:a.nameZh,bones:16,contactError:0,stanceDrift:0,offscreenFrames:[],...(a.id==="passenger"?{supportMode:"carried"}:{})})),
 piggyback:{...spec.piggyback!,boundaryZh:"测试结构证据，不是画面验收",samples:Array.from({length:72},(_,i)=>({frame:i+1,supportError:0,expectedSupportGap:0,actualDropMeters:0,gripError:0,passengerFootHeight:.4,blockAmount:piggybackBlockAmount(spec.piggyback!.blockBowl,i+1),supportSide:1,blockError:0,blockTarget:[.3,0,1],blockTip:[.3,0,1]}))},
 storyProps:[{id:"bowl",kind:"bowl",samples:Array.from({length:72},(_,i)=>({frame:i+1,position:[0,0,1],visible:true,fromAnchor:prop.keyframes[0].anchor,toAnchor:prop.keyframes[1].anchor,progress:i/72,gripResidual:0,fillLevel:0}))}]};
 return {studio:{...studio,spec},spec,report};
}
describe("背负单手挡碗完整契约",()=>{
 it("未挡碗时也不能让端碗IK覆盖背负双方的托膝或抱肩",()=>{
  const {spec}=fixture();delete spec.piggyback!.blockBowl;
  for(const id of ['carrier','passenger']){
   spec.storyProps![0].grip!.actorId=id;
   expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
  }
 });
 it("schema与云草稿保留挡碗，统一报告验证另一手托膝与挡手",()=>{
  const {studio,spec,report}=fixture();
  expect(manhuaPrevisStudioSchema.parse(studio).spec.piggyback?.blockBowl).toEqual(spec.piggyback!.blockBowl);
  expect(()=>validatePrevisReport(report,spec)).not.toThrow();
 });
 it("挡碗呈现秒位与文案随timeMap映射",()=>{
  const {spec}=fixture();spec.timeMap={sourceDurationSec:3,spans:[{sourceStartSec:0,sourceEndSec:3,rate:.5}]};
  const mapped=previsPresentationGuideSpec(spec);
  expect(mapped.piggyback!.blockBowl).toMatchObject({startSec:0,contactSec:1,releaseSec:3,endSec:5});
  expect(formatPrevisMotionGuide(spec)).toContain("1—3秒挡住实际碗bowl，5秒回托膝");
 });
 it.each(["missing","offset","scaledBowl","moving","slip","selfGrip"])("拒绝不成立的 %s 配置",kind=>{
  const {spec}=fixture();
  if(kind==="missing")spec.piggyback!.blockBowl!.bowlId="absent";
  if(kind==="offset")spec.piggyback!.blockBowl!.offset=[0,0,0];
  if(kind==="scaledBowl")for(const k of spec.storyProps![0].keyframes)k.scale=2;
  if(kind==="moving")for(const a of spec.actors.slice(0,2))a.end=[1,0];
  if(kind==="slip")spec.piggyback!.slipCatch={slipStartSec:0,catchSec:1,recoverEndSec:2,dropMeters:.1};
  if(kind==="selfGrip")spec.storyProps![0].grip!.actorId="carrier";
  expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
 });
 it.each(["support","grip","feet","blockTarget","blockAmount","side"])("不能用单手名义放松 %s 验证",kind=>{
  const {spec,report}=fixture();const row=report.piggyback.samples[20];
  if(kind==="support")row.supportError=.04;
  if(kind==="grip")row.gripError=.04;
  if(kind==="feet")row.passengerFootHeight=0;
  if(kind==="blockTarget")row.blockTip[0]+=.1;
  if(kind==="blockAmount")row.blockAmount=0;
  if(kind==="side")row.supportSide=-1;
  expect(()=>validatePrevisReport(report,spec)).toThrow();
 });
});
