import { describe, it, expect } from "vitest";
import { creativeVoiceProductionSchema } from "@shared/creativeVoiceProduction";
import { saveVoiceStoryboard, requireVoiceStoryboardCandidate, voiceStoryboardSource, type VoiceStoryboardCandidate } from "./creativeVoiceStoryboard";
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
