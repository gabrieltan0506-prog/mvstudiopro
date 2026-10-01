import { describe,it,expect,vi } from "vitest";
import { askManhuaBgmMix, generateGeminiBgmAnalysis } from "./manhuaAdvisorBgmMix";
import { parseAdvisorBgmMixPlan } from "../../shared/manhuaAdvisorBgmMix";
const native=vi.hoisted(()=>({upload:vi.fn(),get:vi.fn(),delete:vi.fn(),generateContent:vi.fn()}));
vi.mock("./gemini35FlashRuntime",()=>({buildGeminiApiClient:()=>({files:{upload:native.upload,get:native.get,delete:native.delete},models:{generateContent:native.generateContent}})}));
const target={sourceKey:"v1",videoUri:"gs://test/post-prod/7/video.mp4",bgmUri:"gs://test/post-prod/7/music.wav",entrySec:0,durationSec:29,volume:0.5,fadeInSec:0,fadeOutSec:0};
const validResponse=JSON.stringify({answer:{kind:"bgm_mix_v1",sourceKey:"v1",summaryZh:"原曲配合表演",narrativeMix:[],duckUnderDialogue:false,uncertaintiesZh:[]}});
function fixture(){
 const deps={resolve:vi.fn().mockResolvedValue({action:"bgm_mount",params:{videoUri:target.videoUri,bgmUri:target.bgmUri}}),read:vi.fn(async(uri:string)=>Buffer.from(uri.endsWith("mp4")?"0000ftypisom0000":"RIFF0000WAVE0000")),generate:vi.fn().mockResolvedValue({text:validResponse}),save:vi.fn(async (_params:{objectName:string;buffer:Buffer;contentType:string})=>({gcsUri:"gs://test/evidence.json"}))};
 return deps;
}
describe("Gemini配乐真实多模态输入",()=>{
 it("素材经本人权限解析，实际完整视频和独立BGM字节同时送入固定模型",async()=>{
  const deps=fixture();
  expect(await askManhuaBgmMix(7,target,[{role:"user",content:"配乐补充眼神表演"}],deps as any)).toBe(validResponse);
  expect(deps.resolve.mock.calls[0][0].userId).toBe("7");
  const input=deps.generate.mock.calls[0][0] as any;
  expect(input.model).toBe("gemini-3.8-flash");
  expect(input.contents[0].parts.slice(1)).toEqual([{inlineData:{mimeType:"video/mp4",data:Buffer.from("0000ftypisom0000").toString("base64")}},{inlineData:{mimeType:"audio/wav",data:Buffer.from("RIFF0000WAVE0000").toString("base64")}}]);
  expect(deps.save.mock.calls.map(call=>call[0].objectName.split("/").at(-1))).toEqual(["raw.json","parsed.json"]);
  expect(input.config.systemInstruction).toContain("绝不一律压低");
 });
 it("跨用户素材在读取/模型调用前拒绝",async()=>{
  const deps=fixture();deps.resolve.mockRejectedValue(new Error("无权访问"));
  await expect(askManhuaBgmMix(7,target,[],deps as any)).rejects.toThrow("无权访问");
  expect(deps.read).not.toHaveBeenCalled();expect(deps.generate).not.toHaveBeenCalled();
 });
 it("缺失音频不做文字降级，也不重试另一模型",async()=>{
  const deps=fixture();deps.read.mockResolvedValue(Buffer.alloc(0));
  await expect(askManhuaBgmMix(7,target,[],deps as any)).rejects.toThrow("无效");expect(deps.generate).not.toHaveBeenCalled();
 });
 it("旧版本建议、超出选段的建议不能回填",()=>{
  const plan={kind:"bgm_mix_v1",sourceKey:"old",summaryZh:"沿用原曲",narrativeMix:[],duckUnderDialogue:false,uncertaintiesZh:[]};
  expect(()=>parseAdvisorBgmMixPlan(JSON.stringify(plan),target)).toThrow("旧视频");
  expect(()=>parseAdvisorBgmMixPlan(JSON.stringify({...plan,sourceKey:"v1",narrativeMix:[{startSec:28,endSec:30,gainStart:0.5,gainEnd:0.7,role:"支持表演",noteZh:"眼神"}]}),target)).toThrow("窗口");
 });
});

it("大素材走原生文件接口，保留完整视频和音乐并清理本次临时文件",async()=>{
 native.upload.mockResolvedValueOnce({name:"files/video-test",uri:"https://test.invalid/video",state:"ACTIVE"}).mockResolvedValueOnce({name:"files/audio-test",uri:"https://test.invalid/audio",state:"ACTIVE"});
 native.generateContent.mockResolvedValue({text:"candidate"});native.delete.mockResolvedValue({});
 const input={model:"gemini-3.8-flash",contents:[{role:"user",parts:[{inlineData:{mimeType:"video/mp4",data:Buffer.alloc(18*1024*1024).toString("base64")}},{inlineData:{mimeType:"audio/wav",data:Buffer.from("RIFF0000WAVE0000").toString("base64")}}]}]};
 await generateGeminiBgmAnalysis(input);
 expect(native.upload).toHaveBeenCalledTimes(2);
 expect(native.upload.mock.calls[0][0].file.size).toBe(18*1024*1024);
 expect(native.generateContent.mock.calls[0][0].contents[0].parts).toEqual([{fileData:{mimeType:"video/mp4",fileUri:"https://test.invalid/video"}},{fileData:{mimeType:"audio/wav",fileUri:"https://test.invalid/audio"}}]);
 expect(native.delete).toHaveBeenCalledWith({name:"files/video-test"});expect(native.delete).toHaveBeenCalledWith({name:"files/audio-test"});
});

it("响应解析失败仍永久保存原始证据，不保存伪造的解析结果",async()=>{
 const deps=fixture();deps.generate.mockResolvedValue({text:"invalid json"});
 await expect(askManhuaBgmMix(7,target,[],deps as any)).rejects.toThrow();
 expect(deps.save).toHaveBeenCalledTimes(1);
 expect(deps.save.mock.calls[0][0].objectName).toMatch(/raw\.json$/);
});
