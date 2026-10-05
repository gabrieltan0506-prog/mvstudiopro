import { expect, it, vi, beforeEach } from "vitest";
vi.mock("./manhuaNativeDeepReadRunner",async importOriginal=>({ ...await importOriginal<typeof import("./manhuaNativeDeepReadRunner")>(), assertNativeDeepReadRequiredSegmentEvidence:vi.fn(),evaluateNativeDeepReadSegmentAcceptance:vi.fn(()=>({retry:false,advisories:[]})) }));
import { askManhuaFilmReview, resolveAdvisorFilmSource } from "./manhuaAdvisorFilmReview";
import {assertNativeDeepReadRequiredSegmentEvidence,evaluateNativeDeepReadSegmentAcceptance} from "./manhuaNativeDeepReadRunner";
const target={videoUri:"https://storage.googleapis.com/test/film.mp4",blockId:"clip-1",revision:"v1",label:"第1段"};
const analysis={originalEvidence:{retained:"完整原生结果"},filmReview:{summary:"构图有层次",findings:[{kind:"亮点",atSec:1,endSec:2,category:"构图",observation:"前景遮挡",suggestion:"保留层次",confidence:"明确"}],limitations:"声音仍需核对"}};
function fixture(){return {resolve:vi.fn().mockResolvedValue("gs://test/film.mp4"),inspect:vi.fn().mockResolvedValue({generation:"1"}),probe:vi.fn().mockResolvedValue({durationSec:5,audioStreams:[{}]}),count:vi.fn().mockResolvedValue({totalTokens:100}),post:vi.fn().mockResolvedValue({status:200,text:JSON.stringify({modelVersion:"gemini-3.8-flash",usageMetadata:{promptTokensDetails:[{modality:"AUDIO",tokenCount:119}]},candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(analysis)}]}}]})}),save:vi.fn().mockResolvedValue("saved")};}
beforeEach(()=>{vi.mocked(assertNativeDeepReadRequiredSegmentEvidence).mockReset();vi.mocked(evaluateNativeDeepReadSegmentAcceptance).mockReset().mockReturnValue({retry:false,advisories:[]} as any)});
it("原生审片保留完整证据并调用原学习门禁；原参数不变",async()=>{
 const d=fixture();const result=JSON.parse(JSON.parse(await askManhuaFilmReview(7,target,"灯光",d as any)).answer);
 expect(result.nativeEvidence.analysis).toEqual(analysis);expect(result.findings[0].kind).toBe("亮点");
 expect(assertNativeDeepReadRequiredSegmentEvidence).toHaveBeenCalledWith(expect.objectContaining({raw:analysis,startSec:0,endSec:5,hasAudio:true}));
 expect(evaluateNativeDeepReadSegmentAcceptance).toHaveBeenCalled();
 expect(d.post.mock.calls[0][0].generationConfig).toMatchObject({temperature:0.7,maxOutputTokens:65536,audioTimestamp:true,thinkingConfig:{thinkingLevel:"MEDIUM"}});
 expect(d.post).toHaveBeenCalledTimes(1);
});
it("原生门禁失败仍保留原始和解析JSON，不重投",async()=>{
 const d=fixture();vi.mocked(assertNativeDeepReadRequiredSegmentEvidence).mockImplementationOnce(()=>{throw Error("native gate failed")});
 await expect(askManhuaFilmReview(7,target,"x",d as any)).rejects.toThrow("native gate");
 const names=d.save.mock.calls.map(c=>c[0].objectName);expect(names.some(n=>n.endsWith('/raw.json'))).toBe(true);expect(names.some(n=>n.endsWith('/analysis.json'))).toBe(true);expect(d.post).toHaveBeenCalledTimes(1);
});
it("审片附加建议越界拒绝，不夹断时间也不重投",async()=>{
 const d=fixture();d.probe.mockResolvedValue({durationSec:1,audioStreams:[{}]});await expect(askManhuaFilmReview(7,target,"x",d as any)).rejects.toThrow("时间超出");expect(d.post).toHaveBeenCalledTimes(1);
});
it("画布独立任务审片只放行本人成功产物，拒绝其他对象且不掩盖数据库故障", async()=>{
 const originalError = new Error("素材尚未登记,请从画布/成片里重新选择站内素材");
 const resolve = vi.fn(async(input:any,_deps?:any,context?:any)=>{
  if(context?.jobObjects.has(input.source)) return "gs://test/owned.mp4";
  throw originalError;
 });
 const loadCanvas=vi.fn().mockResolvedValue(new Set(["owned.mp4"]));
 expect(await resolveAdvisorFilmSource({userId:"7",source:"owned.mp4"},{resolve:resolve as any,loadCanvas})).toBe("gs://test/owned.mp4");
 expect(loadCanvas).toHaveBeenCalledWith(7);
 await expect(resolveAdvisorFilmSource({userId:"7",source:"other.mp4"},{resolve:resolve as any,loadCanvas})).rejects.toThrow("尚未登记");
 resolve.mockRejectedValueOnce(Error("数据库不可用")); loadCanvas.mockClear();
 await expect(resolveAdvisorFilmSource({userId:"7",source:"owned.mp4"},{resolve:resolve as any,loadCanvas})).rejects.toThrow("数据库不可用");expect(loadCanvas).not.toHaveBeenCalled();
});
