import { rememberLocalMediaDisplay } from "./manhuaLocalMediaStore";
import { describe, it, expect } from "vitest";
import { creativeVoiceProductionSchema } from "@shared/creativeVoiceProduction";
import { archiveFailedVoiceStoryboard, saveVoiceStoryboard, requireVoiceStoryboardCandidate, voiceStoryboardSource, type VoiceStoryboardCandidate } from "./creativeVoiceStoryboard";
import { defaultCanvasBlock } from "./canvasTypes";

describe("语音分镜候选保存与采用边界", () => {
  const blocks = [{...defaultCanvasBlock("text",0,0),id:"reverse-e01",outputText:"完整分镜"}];
  const source = voiceStoryboardSource(blocks,[],"确认正文");
  const candidate: VoiceStoryboardCandidate = {id:"request-test",scope:"test-user:test-project",episode:1,source,status:"ready",text:"完整分镜",blocks,edges:[]};
  it("生成与采用是不同工具动作，拒绝缺集数、空要求和额外授权字段", () => {
    expect(creativeVoiceProductionSchema.safeParse({action:"prepareStoryboard",episode:1,question:"按原剧本拆分镜"}).success).toBe(true);
    expect(creativeVoiceProductionSchema.safeParse({action:"applyStoryboard",episode:1}).success).toBe(true);
    for(const value of [{action:"prepareStoryboard",question:"分镜"},{action:"prepareStoryboard",episode:1,question:""},{action:"applyStoryboard",episode:1,confirmPaid:true}]) expect(creativeVoiceProductionSchema.safeParse(value).success).toBe(false);
  });
  it("完整候选刷新可读，跨作品、跨集、正文改变及未决结果不能采用", () => {
    const data=new Map<string,string>();const storage={setItem:(k:string,v:string)=>{data.set(k,v)},getItem:(k:string)=>data.get(k)||null};
    saveVoiceStoryboard(storage,"candidate",candidate);
    const recovered=JSON.parse(storage.getItem("candidate")!);
    expect(requireVoiceStoryboardCandidate(recovered,candidate.scope,1,source).blocks).toEqual(blocks);
    expect(()=>requireVoiceStoryboardCandidate(recovered,"other",1,source)).toThrow();
    expect(()=>requireVoiceStoryboardCandidate(recovered,candidate.scope,2,source)).toThrow();
    expect(()=>requireVoiceStoryboardCandidate(recovered,candidate.scope,1,voiceStoryboardSource(blocks,[],"新正文"))).toThrow("已变化");
    expect(()=>requireVoiceStoryboardCandidate({...recovered,status:"pending"},candidate.scope,1,source)).toThrow();
  });
  it("存储静默丢写或容量失败均阻止确认成功", () => {
    expect(()=>saveVoiceStoryboard({setItem:()=>{},getItem:()=>null},"candidate",candidate)).toThrow("未完整保存");
    expect(()=>saveVoiceStoryboard({setItem:()=>{throw Error("quota")},getItem:()=>null},"candidate",candidate)).toThrow("quota");
  });
});

it("失败记录先完整归档才能解除阻断，在途和已返回完整稿不允许丢弃重下",()=>{
 const map=new Map<string,string>(),storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},removeItem:(k:string)=>{map.delete(k)}};
 const c={id:"old",scope:"test",episode:1,source:"test",status:"pending" as const,error:"任务明确失败",upstreamStatus:"failed" as const};
 saveVoiceStoryboard(storage,"key",c);archiveFailedVoiceStoryboard(storage,"key","old");expect(map.has("key")).toBe(false);expect(JSON.parse(map.get("key:history:old")!)).toEqual(c);
 for(const invalid of [{...c,upstreamStatus:undefined},{...c,error:undefined},{...c,text:"已返回的完整付费产物"},{...c,upstreamTaskId:"task",upstreamStatus:"running" as const},{...c,upstreamTaskId:"task",upstreamStatus:"succeeded" as const}]){saveVoiceStoryboard(storage,"key",invalid);expect(()=>archiveFailedVoiceStoryboard(storage,"key","old")).toThrow();expect(map.has("key")).toBe(true);}
});


it("同一素材从显示blob换为本机指针不失效，换图片或正文仍拒绝", () => {
  const blob = "blob:http://127.0.0.1/test-cached-image";
  const pointer = "local-media:v1/source-sha256-test-source";
  rememberLocalMediaDisplay({displayUrl:blob,pointer,sourceUrl:"https://example.test/owned.png"});
  const base={...defaultCanvasBlock("image",0,0),id:"image-test",outputUrl:blob};
  const original=voiceStoryboardSource([base],[],JSON.stringify({body:"原稿",refs:[{url:blob}]}));
  const cached=voiceStoryboardSource([{...base,outputUrl:pointer,uploadFailures:[]}],[],JSON.stringify({refs:[{url:pointer}],body:"原稿"}));
  expect(cached).toBe(original);
  expect(voiceStoryboardSource([{...base,outputUrl:"https://example.test/new.png"}],[],"原稿")).not.toBe(original);
  expect(voiceStoryboardSource([base],[],JSON.stringify({body:"改稿",refs:[{url:blob}]}))).not.toBe(original);
  const c={id:"test",scope:"test",episode:1,source:JSON.stringify({blocks:[base],edges:[],body:JSON.stringify({body:"原稿",refs:[{url:blob}]})}),status:"ready" as const,text:"完整分镜",blocks:[base],edges:[]};
  expect(requireVoiceStoryboardCandidate(c,"test",1,cached)).toBe(c);
});
