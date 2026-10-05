import { expect, it, vi } from "vitest";
import { askManhuaFilmReview, resolveAdvisorFilmSource } from "./manhuaAdvisorFilmReview";
const target = { videoUri: "https://storage.googleapis.com/test/film.mp4", blockId: "clip-1", revision: "v1", label: "第1段" };
const analysis={summaryZh:"前景遮挡制造压迫",shots:[{startSec:0,endSec:5,descriptionZh:"前景遮挡人物"}],audioSegments:[{startSec:0,endSec:5,descriptionZh:"轻音乐"}],subtitles:[],findings:[{atSec:2,modality:"visual",status:"interpretation",issueZh:"暗部",evidenceZh:"面部落在暗部",suggestionZh:"增加左侧柔光"}]};
function fixture(){return {resolve:vi.fn().mockResolvedValue("gs://test/film.mp4"),inspect:vi.fn().mockResolvedValue({generation:"1"}),probe:vi.fn().mockResolvedValue({durationSec:5,audioStreams:[{}]}),count:vi.fn().mockResolvedValue({totalTokens:100}),post:vi.fn().mockResolvedValue({status:200,text:JSON.stringify({modelVersion:"gemini-3.8-flash",usageMetadata:{promptTokensDetails:[{modality:"AUDIO",tokenCount:119}]},candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(analysis)}]}}]})}),save:vi.fn().mockResolvedValue("saved")};}
it("observer合同一次送原片，保留音画证据、版本、usage；不另拆轨",async()=>{
 const d=fixture();const result=JSON.parse(JSON.parse(await askManhuaFilmReview(7,target,"灯光",d as any)).answer);
 expect(result.observerEvidence.analysis).toEqual(analysis);expect(result.observerEvidence.audioTokens).toBe(119);
 const body=d.post.mock.calls[0][0];expect(body.contents[0].parts[0]).toEqual({fileData:{fileUri:"gs://test/film.mp4",mimeType:"video/mp4"},videoMetadata:{fps:12}});
 expect(body.generationConfig).toMatchObject({temperature:0.2,maxOutputTokens:16000,responseMimeType:"application/json"});expect(body.generationConfig.responseSchema.required).toContain("audioSegments");expect(body.generationConfig.thinkingConfig).toBeUndefined();expect(d.post).toHaveBeenCalledTimes(1);expect(d.inspect).toHaveBeenCalledTimes(2);
});
it("observer版本变化拒绝生成；供应商错误或截断保留回执且不重试",async()=>{
 const d=fixture();d.inspect.mockResolvedValueOnce({generation:"1"}).mockResolvedValueOnce({generation:"2"});await expect(askManhuaFilmReview(7,target,"x",d as any)).rejects.toThrow("版本");expect(d.post).not.toHaveBeenCalled();
 d.post.mockResolvedValueOnce({status:400,text:"invalid"});await expect(askManhuaFilmReview(7,target,"x",d as any)).rejects.toThrow("400");expect(d.post).toHaveBeenCalledTimes(1);
 d.post.mockResolvedValueOnce({status:200,text:JSON.stringify({candidates:[{finishReason:"MAX_TOKENS"}]})});await expect(askManhuaFilmReview(7,target,"x",d as any)).rejects.toThrow("未完整");expect(d.post).toHaveBeenCalledTimes(2);
});
it("observer拒绝越界声音证据，不重投",async()=>{const d=fixture();d.probe.mockResolvedValue({durationSec:1,audioStreams:[{}]});await expect(askManhuaFilmReview(7,target,"x",d as any)).rejects.toThrow("outside");expect(d.post).toHaveBeenCalledTimes(1);});

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
