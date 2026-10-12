import {expect,it,vi} from "vitest";
vi.mock("../_core/llm",()=>({invokeLLM:vi.fn(),extractFirstChoicePlainText:(v:any)=>v.choices[0].message.content}));
vi.mock("./codeMotionStore",()=>({loadCodeMotion:vi.fn()}));
import {generateCodeMotionRevisionProposal} from "./codeMotionRevisionProposal";
import {codeMotionProjectSchema} from "../../shared/codeMotion";
import {reviseCodeMotionProject} from "../../shared/codeMotionRevision";
const id="11111111-1111-4111-8111-111111111111";
const project=codeMotionProjectSchema.parse({id,brief:{title:"test",request:"显示内容",style:"scenes",duration:20,orientation:"landscape",images:[],data:[]},plan:{version:1,summary:"原稿",scenes:Array.from({length:4},(_,i)=>({heading:`标题${i}`,body:"内容",duration:5,direction:"文字出现",composition:{id:`scene${i}`,duration:5,elements:[{id:`title${i}`,type:"text",text:`标题${i}`}]}}))}});
it("owned saved source produces a real code change; unknown source fails before advisor; model cannot fabricate an original clip",async()=>{
 const brief={...project.brief,revisionSource:{projectId:id,generation:"1",instruction:"开头标题改暖色"}};
 const composition=structuredClone(project.plan!.scenes[0].composition!);composition.elements[0].transform.fill="#ee9955";
 const proposal={summary:"开头标题改暖色",changes:[{index:0,heading:"标题0",body:"内容",composition}],limitations:[]};
 const invoke=vi.fn(async()=>({choices:[{message:{content:JSON.stringify(proposal)},finish_reason:"stop"}]} as any));
 const load=vi.fn(async()=>({project,generation:"1",updatedAt:new Date().toISOString()}));
 const result=await generateCodeMotionRevisionProposal("7",brief,{load,invoke});
 const child=reviseCodeMotionProject(project,"22222222-2222-4222-8222-222222222222",JSON.parse(result.answer).changes);expect(child.plan!.scenes[0].composition!.elements[0].transform.fill).toBe("#ee9955");expect(project.plan!.scenes[0].composition!.elements[0].transform.fill).toBeUndefined();expect(child.plan!.scenes[1]).toEqual(project.plan!.scenes[1]);expect(load).toHaveBeenCalledWith("7",id);
 invoke.mockClear();await expect(generateCodeMotionRevisionProposal("8",brief,{load:async()=>null,invoke})).rejects.toThrow("版本已变化");expect(invoke).not.toHaveBeenCalled();
 invoke.mockResolvedValue({choices:[{message:{content:JSON.stringify({...proposal,changes:[{index:0,heading:"标题0",body:"内容",motionPrompt:"人走路"}]})},finish_reason:"stop"}]} as any);
 await expect(generateCodeMotionRevisionProposal("7",brief,{load,invoke})).rejects.toThrow("没有可编辑");
});

it("a proposed code overlay on an archived dialogue video becomes a limitation without deleting that clip",async()=>{
 const original=structuredClone(project);
 original.plan!.scenes[0].speech={text:"你好",voice:"male",role:"dialogue"};
 original.plan!.codeVideo={version:1,assets:[{id:"video",videoUri:"gs://fixture/original.mp4",sha256:"a".repeat(64),durationSec:5}],clips:[{assetId:"video",at:0,duration:5,sourceStartSec:0,fit:"cover"}]};
 const before=JSON.stringify(original);
 const brief={...original.brief,revisionSource:{projectId:id,generation:"1",instruction:"把对白镜头标题改红色"}};
 const composition=structuredClone(original.plan!.scenes[0].composition!);composition.elements[0].transform.fill="#ff0000";
 const invoke=vi.fn(async()=>({choices:[{message:{content:JSON.stringify({summary:"标题已改红",changes:[{index:0,heading:"新标题",body:"内容",composition}],limitations:Array.from({length:6},(_,i)=>`原限制${i}`)})},finish_reason:"stop"}]} as any));
 const result=JSON.parse((await generateCodeMotionRevisionProposal("7",brief,{load:async()=>({project:original,generation:"1",updatedAt:new Date().toISOString()}),invoke})).answer);
 expect(result.changes).toEqual([]);expect(result.limitations).toHaveLength(7);expect(result.limitations[6]).toContain("已有原视频");expect(result.summary).toContain("未修改");
 expect(JSON.stringify(original)).toBe(before);expect(invoke).toHaveBeenCalledTimes(1);
});
