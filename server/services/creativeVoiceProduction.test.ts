import { expect,it } from "vitest";
import { normalizeVoiceMessage, voiceSetup } from "./creativeVoiceTransport";
import { creativeVoiceConnectionPlans } from "./creativeVoiceFallback";
it("两路语音配乐只接受真实片段与原操作，不接受伪造确认或提示词替换", () => {
 for (const extended of [false,true]) for (const operation of ["inspect","prepare","generate"]) {
  const args = { action:"bgm", operation, clipId:"clip-e01-g01", ...(operation === "prepare" ? { question:"用户要求结尾留白" } : {}) };
  const event = (input: unknown) => normalizeVoiceMessage(extended,{toolCall:{functionCalls:[{id:"bgm",name:"creativeProduction",args:input}]}} as any);
  expect(event(args)).toMatchObject([{type:"production",action:args}]);
  for (const extra of [{confirmed:true},{approved:true},{prompt:"模型自写替代剧情"},{url:"https://other.invalid/audio.mp3"}]) expect(event({...args,...extra})[0].type).toBe("toolRejected");
  expect(event({...args,clipId:""})[0].type).toBe("toolRejected");
 }
 for (const plan of [...creativeVoiceConnectionPlans(false),...creativeVoiceConnectionPlans(true)]) {
  const tool = voiceSetup(plan,"作品","p").setup.tools[0].functionDeclarations.find(row=>row.name === "creativeProduction")!;
  expect(tool.parameters.properties.action?.enum).toContain("bgm");
  expect(tool.parameters.properties.operation?.enum).toEqual(expect.arrayContaining(["inspect","prepare","generate"]));
  expect(tool.description).toContain("question只填写用户真实补充要求，不能替换剧情");
  expect(tool.description).toContain("awaiting_user_confirmation");
 }
});
it("production bridge validates all actions on both model routes without accepting forged approval",()=>{
 const actions=[{action:"inspect"},{action:"assets"},{action:"image2d",anchorId:"hero"},{action:"model3d",assetId:"ref"},{action:"previs",clipId:"clip"},{action:"renderPrevis",question:"镜头压低并向前推进，生成白模试看"},{action:"applyEpisode",episode:2},{action:"applyPrevis"}];
 for(const extended of [false,true])for(const action of actions){const m:any={toolCall:{functionCalls:[{id:"task",name:"creativeProduction",args:action}]}};expect(normalizeVoiceMessage(extended,m)).toMatchObject([{type:"production",action}]);m.toolCall.functionCalls[0].args={...action,approved:true};expect(normalizeVoiceMessage(extended,m)[0].type).toBe("toolRejected");}
 for(const p of [...creativeVoiceConnectionPlans(false),...creativeVoiceConnectionPlans(true)])expect(voiceSetup(p,"test","probe").setup.tools[0].functionDeclarations.some(f=>f.name==='creativeProduction')).toBe(true);
});
it("every known tool returns a rejection receipt for bad arguments instead of hanging the conversation",()=>{
 for(const name of ['novelText','creativeProduction','creativeWorkflow','askCreativeAdvisor','proposeMediaEdit','reviewFilm'])expect(normalizeVoiceMessage(true,{toolCall:{functionCalls:[{id:'bad-'+name,name,args:{}}]}} as any)).toMatchObject([{type:'toolRejected',name}]);
});

it("world bridge accepts scene selection and confirmed generation routes but rejects injected approval",()=>{
 for(const extended of [false,true])for(const action of [{action:"world",assetId:"scene-ref"},{action:"generateWorld"}]){
 const event=(args:unknown)=>normalizeVoiceMessage(extended,{toolCall:{functionCalls:[{id:"world-probe",name:"creativeProduction",args}]}} as any);
 expect(event(action)).toMatchObject([{type:"production",action}]);expect(event({...action,approved:true})).toMatchObject([{type:"toolRejected"}]);
 }
});

it("world retry is an explicit action and never accepts model supplied payment approval",()=>{for(const extended of [false,true]){const event=(args:unknown)=>normalizeVoiceMessage(extended,{toolCall:{functionCalls:[{id:"retry",name:"creativeProduction",args}]}} as any);expect(event({action:"retryWorld",assetId:"scene"})).toMatchObject([{type:"production",action:{action:"retryWorld",assetId:"scene"}}]);expect(event({action:"retryWorld",assetId:"scene",confirmPaid:true})).toMatchObject([{type:"toolRejected"}]);}});

it("media execution reaches both model routes with strict operation validation",()=>{for(const extended of [false,true])for(const operation of ["inspect","previewImage","finishImage","resumeMedia","applyImage","editVideo"]){const event=(args:unknown)=>normalizeVoiceMessage(extended,{toolCall:{functionCalls:[{id:"media",name:"creativeProduction",args}]}} as any);expect(event({action:"media",operation})).toMatchObject([{type:"production",action:{action:"media",operation}}]);expect(event({action:"media",operation,approved:true})).toMatchObject([{type:"toolRejected"}]);}});
