import { describe, expect, it } from "vitest";
import { previsStoryPropsSchema, storyPropsIssue } from "./manhuaPrevisStoryProps";
const bone=(actorId="doctor",name="hand1")=>({type:"bone",actorId,bone:name,along:1,offset:[0,0,0]});
const track=(id:string,anchor:unknown)=>({id,kind:"needle",keyframes:[{timeSec:0,anchor},{timeSec:2,anchor}]});
const actors=[{id:"doctor",shape:"human"},{id:"horse",shape:"horse"}];
it("取针用独立轨迹驱动手腕，离手后才绑定落点",()=>{
 const world=(position:number[])=>({type:"world",position});
 const props=previsStoryPropsSchema.parse([{id:"needle",kind:"needle",grip:{actorId:"doctor",hand:"hand1",startSec:0,endSec:1},keyframes:[
  {timeSec:0,anchor:world([.3,0,1])},{timeSec:1,anchor:world([.4,0,1.3])},
  {timeSec:1.5,anchor:bone("doctor","neck")},{timeSec:2,anchor:bone("doctor","neck")},
 ]}]);
 expect(storyPropsIssue(props,actors,2)).toBeNull();
 const loop=structuredClone(props);loop[0].keyframes[0].anchor=previsStoryPropsSchema.parse([track("temp",bone())])[0].keyframes[0].anchor;
 expect(storyPropsIssue(loop,actors,2)).toMatch(/独立世界锚点/);
 const early=structuredClone(props);early[0].grip!.endSec=1.25;
 expect(storyPropsIssue(early,actors,2)).toMatch(/独立世界锚点/);
 expect(storyPropsIssue([...props,{...props[0],id:"second"}],actors,2)).toMatch(/同一只手/);
});
describe("剧情道具真实锚点契约",()=>{
 it("保留落针同一骨局部点及整段初末态",()=>{const p=previsStoryPropsSchema.parse([track("needle",bone())]);expect(storyPropsIssue(p,actors,2)).toBeNull();expect(p[0].keyframes[1].anchor).toEqual(p[0].keyframes[0].anchor);});
 it("拒绝不存在的演员或错误形态骨名",()=>{expect(storyPropsIssue(previsStoryPropsSchema.parse([track("n",bone("ghost"))]),actors,2)).toMatch(/不存在/);expect(storyPropsIssue(previsStoryPropsSchema.parse([track("n",bone("horse"))]),actors,2)).toMatch(/骨名/);});
 it("血滴可落入先声明的碗，禁止前向和循环引用",()=>{const bowl={...track("b",bone()),kind:"bowl"};const drop={...track("drop",{type:"prop",propId:"b",offset:[0,0,.03]}),kind:"blood_drop"};expect(storyPropsIssue(previsStoryPropsSchema.parse([bowl,drop]),actors,2)).toBeNull();expect(storyPropsIssue(previsStoryPropsSchema.parse([drop,bowl]),actors,2)).toMatch(/循环/);});
 it("禁止静默缺首尾、重复 ID 和无序时间",()=>{const p=previsStoryPropsSchema.parse([track("n",bone())]);expect(storyPropsIssue(p,actors,3)).toMatch(/首尾/);expect(storyPropsIssue([...p,...p],actors,2)).toMatch(/重复/);p[0].keyframes.splice(1,0,{...p[0].keyframes[0]});expect(storyPropsIssue(p,actors,2)).toMatch(/递增/);});
});
it("端碗只接受独立人手且禁止两碗争用同手",()=>{
 const p=previsStoryPropsSchema.parse([{...track("b",bone()),kind:"bowl",grip:{actorId:"doctor",hand:"hand1"}}]);
 expect(storyPropsIssue(p,actors,2)).toBeNull();
 expect(storyPropsIssue([...p,{...p[0],id:"b2"}],actors,2)).toMatch(/同一只手/);
 const horse=structuredClone(p);horse[0].grip!.actorId="horse";expect(storyPropsIssue(horse,actors,2)).toMatch(/人形/);
});
it("刀坛支持固定台面与顺序换手，世界坐标有限且不接URL",()=>{
 const world={type:"world",position:[.5,.5,1]};
 const props=previsStoryPropsSchema.parse([{...track("knife",bone()),kind:"knife",grip:{actorId:"doctor",hand:"hand1",startSec:0,endSec:1}},{...track("jar",world),kind:"jar",grip:{actorId:"doctor",hand:"hand1",startSec:1,endSec:2}}]);
 expect(storyPropsIssue(props,actors,2)).toBeNull();
 props[1].grip!.startSec=.5;expect(storyPropsIssue(props,actors,2)).toMatch(/重叠/);
 expect(()=>previsStoryPropsSchema.parse([{...track("j",{type:"world",position:[11,0,0]}),kind:"jar"}])).toThrow();
 expect(()=>previsStoryPropsSchema.parse([{...track("j",world),kind:"jar",url:"https://example.com/model.glb"}])).toThrow();
});

it("信息卡左右手独立交互且禁止骨锚反向循环",()=>{
 const panel=(id:string,hand:"hand1"|"hand-1")=>({id,kind:"information_panel",proxy:{size:[.2,.02,.2],color:[.1,.4,.8]},grip:{actorId:"doctor",hand,startSec:0,endSec:2},keyframes:[{timeSec:0,anchor:{type:"world",position:[.3,0,1.2]}},{timeSec:2,anchor:{type:"world",position:[.4,0,1.2]}}]});
 const p=previsStoryPropsSchema.parse([panel("left","hand1"),panel("right","hand-1")]);expect(storyPropsIssue(p,actors,2)).toBeNull();
 p[1].keyframes[1].anchor=previsStoryPropsSchema.parse([track("t",bone())])[0].keyframes[0].anchor;expect(storyPropsIssue(p,actors,2)).toMatch(/独立世界锚点/);
});
