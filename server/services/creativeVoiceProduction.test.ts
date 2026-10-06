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

it("七组新动作在两条实时语音路由解析为同一生产事件，拒绝伪造费用确认", () => {
 const actions = [
  {action:"writer",operation:"configure",topic:"宫廷悬疑"},
  {action:"asset",operation:"primary",assetId:"ref-1",anchorId:"actor-1",duty:"identity"},
  {action:"modelControl",operation:"multiviewSubmit",assetId:"ref-1"},
  {action:"worldControl",operation:"exportFrame",assetId:"world-1",clipId:"clip-1"},
  {action:"generate",operation:"clip",episode:1,blockId:"clip-1"},
  {action:"audio",operation:"configureCue",clipId:"clip-1",cueId:"cue-1",patch:{volume:0.5}},
  {action:"scoring",operation:"configure",clipId:"clip-1",musicId:"adopted-1"},
  {action:"edit",operation:"trim",episode:1,shotIndex:1,inSec:0.5,outSec:2},
  {action:"deliver",operation:"assemble",episode:1},
 ];
 for (const extended of [false,true]) for (const action of actions) {
  const event = (args:unknown) => normalizeVoiceMessage(extended,{toolCall:{functionCalls:[{id:"workflow",name:"creativeProduction",args}]}} as any);
  expect(event(action)).toMatchObject([{type:"production",action}]);
  expect(event({...action,confirmPaid:true})).toMatchObject([{type:"toolRejected"}]);
 }
});

it("混音提交在两路Live都必须携带原inspect版本，工具说明同步暴露sourceKey", () => {
  for (const extended of [false, true]) {
    const event = (args: unknown) => normalizeVoiceMessage(extended, { toolCall: { functionCalls: [{ id: "scoring-source", name: "creativeProduction", args }] } } as any);
    const action = { action: "scoring", operation: "submit", sourceKey: "scoring:test-current" };
    expect(event(action)).toMatchObject([{ type: "production", action }]);
    expect(event({ action: "scoring", operation: "submit" })).toMatchObject([{ type: "toolRejected" }]);
    for (const plan of creativeVoiceConnectionPlans(extended)) {
      const tool = voiceSetup(plan, "test", "test-scope").setup.tools[0].functionDeclarations.find(row => row.name === "creativeProduction")!;
      expect(tool.parameters.properties.sourceKey).toBeDefined();
      expect(tool.description).toContain("submit必须原样携带本次scoring inspect的sourceKey");
    }
  }
});

it("所有Live路由的完整工具声明只包含Google Schema字段，正数边界仍有提示", () => {
 const allowed=new Set(["type","format","title","description","nullable","default","items","minItems","maxItems","enum","properties","propertyOrdering","required","minProperties","maxProperties","minimum","maximum","minLength","maxLength","pattern","example","anyOf"]);
 const inspect=(schema:any)=>{
  for(const key of Object.keys(schema))expect(allowed.has(key),`不支持的Schema字段: ${key}`).toBe(true);
  for(const child of Object.values(schema.properties||{}))inspect(child);
  if(schema.items)inspect(schema.items);
  for(const child of schema.anyOf||[])inspect(child);
 };
 for(const extended of [false,true])for(const plan of creativeVoiceConnectionPlans(extended)){
  const tools=voiceSetup(plan,"test","test-project").setup.tools[0].functionDeclarations;
  for(const tool of tools)inspect(tool.parameters);
  const p=tools.find(t=>t.name==="creativeProduction")!.parameters.properties as any;
  expect(p.episode.minimum).toBe(1);
  expect(p.shotIndex.minimum).toBe(1);
  expect(p.order.items.minimum).toBe(1);
  for(const node of [p.outSec,p.patch.properties.endSec,p.patch.properties.sourceEndSec]){
   expect(node.minimum).toBe(0);expect(node.description).toContain("不含边界");
  }
 }
});

it("Live声明转换不放宽工具执行的正数、整数和音轨边界",()=>{
 for(const extended of [false,true]){
  const event=(args:unknown)=>normalizeVoiceMessage(extended,{toolCall:{functionCalls:[{id:"boundary",name:"creativeProduction",args}]}} as any);
  for(const episode of [0,-1,1.5])expect(event({action:"applyEpisode",episode})).toMatchObject([{type:"toolRejected"}]);
  for(const key of ["endSec","sourceEndSec"])for(const value of [0,-0.1])expect(event({action:"audio",operation:"configureCue",clipId:"clip",cueId:"cue",patch:{[key]:value}})).toMatchObject([{type:"toolRejected"}]);
  expect(event({action:"edit",operation:"trim",episode:1,shotIndex:0,inSec:0,outSec:1})).toMatchObject([{type:"toolRejected"}]);
  expect(event({action:"edit",operation:"reorder",episode:1,order:[0,1]})).toMatchObject([{type:"toolRejected"}]);
  expect(event({action:"edit",operation:"trim",episode:1,shotIndex:1,inSec:0,outSec:0})).toMatchObject([{type:"toolRejected"}]);
  expect(event({action:"audio",operation:"configureCue",clipId:"clip",cueId:"cue",patch:{endSec:0.1}})).toMatchObject([{type:"production"}]);
 }
});
