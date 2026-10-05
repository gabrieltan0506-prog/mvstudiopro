import { expect, it, vi } from "vitest";
import { askManhuaFilmReview, resolveAdvisorFilmSource } from "./manhuaAdvisorFilmReview";
const target = { videoUri: "https://storage.googleapis.com/test/film.mp4", blockId: "clip-1", revision: "v1", label: "第1段" };
const report = { kind: "film_review_v1", summary: "前景遮挡制造压迫", findings: [{ atSec: 2, endSec: 3, category: "灯光", observation: "面部落在暗部", suggestion: "增加左侧柔光", confidence: "明确" }], limitations: "抽样审阅，未逐帧核验" };
function fixture() { return { resolve: vi.fn().mockResolvedValue("gs://test/film.mp4"), post: vi.fn().mockResolvedValue({ status: 200, text: JSON.stringify({ candidates: [{content:{parts:[{thought:true,text:"internal"},{text:JSON.stringify(report)}]}}] }) }), save: vi.fn().mockResolvedValue("saved") }; }
it("授权后完整影片URI进入模板学习Vertex通道；保留原始和解析证据，HIGH不使用MAX", async()=>{
 const deps=fixture();const result=JSON.parse(await askManhuaFilmReview(7,target,"看灯光",deps as any));expect(JSON.parse(result.answer)).toEqual(report);
 expect(deps.resolve).toHaveBeenCalledWith({userId:"7",source:target.videoUri});
 const body=deps.post.mock.calls[0][0];expect(body.contents[0].parts[0]).toEqual({fileData:{fileUri:"gs://test/film.mp4",mimeType:"video/mp4"},videoMetadata:{fps:4}});
 expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("HIGH");expect(deps.save).toHaveBeenCalledTimes(2);
});
it("无权访问不打模型；上游失败和格式错误不重复计费、不文字降级",async()=>{
 const deps=fixture();deps.resolve.mockRejectedValueOnce(Error("无权访问"));await expect(askManhuaFilmReview(7,target,"x",deps as any)).rejects.toThrow("无权访问");expect(deps.post).not.toHaveBeenCalled();
 deps.post.mockResolvedValueOnce({status:503,text:"busy"});await expect(askManhuaFilmReview(7,target,"x",deps as any)).rejects.toThrow("503");expect(deps.post).toHaveBeenCalledTimes(1);expect(deps.save).toHaveBeenCalledTimes(1);
 deps.post.mockResolvedValueOnce({status:200,text:'{"candidates":[]}'});await expect(askManhuaFilmReview(7,target,"x",deps as any)).rejects.toThrow();expect(deps.post).toHaveBeenCalledTimes(2);expect(deps.save).toHaveBeenCalledTimes(2);
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
