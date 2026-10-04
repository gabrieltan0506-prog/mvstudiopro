import { expect, it, vi } from "vitest";
import { runAdvisorImageEdit } from "./advisorMediaImageJob";
import { prepareAdvisorMediaPlan, assertAdvisorMediaSource } from "@shared/manhuaAdvisorMediaEdit";
const jobs=vi.hoisted(()=>({createJobSameOrigin:vi.fn(),pollJobUntilTerminal:vi.fn()}));
vi.mock("./jobs",()=>jobs);
const source={blockId:"keyart-1",kind:"image" as const,url:"https://test/original.png",revision:"a",label:"第一镜",aspectRatio:"9:16" as const};
const plan=prepareAdvisorMediaPlan({kind:"image",blockId:source.blockId,instruction:"保留人物，改成月夜"},[source]);
it("Flare和Sunburst显式分开，Sunburst引用原图与确认预览，恢复只查原任务",async()=>{
 jobs.createJobSameOrigin.mockResolvedValue({jobId:"j1"});jobs.pollJobUntilTerminal.mockResolvedValue({status:"succeeded",output:{imageUrl:"https://test/result.png"}});const onJob=vi.fn();
 await runAdvisorImageEdit({plan,userId:"7",variant:"flare",onJob});expect(jobs.createJobSameOrigin.mock.calls[0][0].input.params).toMatchObject({openaiImageVariant:"flare",referenceImageUrls:[source.url],generalImageEdit:true});
 await expect(runAdvisorImageEdit({plan,userId:"7",variant:"sunburst",onJob})).rejects.toThrow("预览");expect(jobs.createJobSameOrigin).toHaveBeenCalledTimes(1);
 await runAdvisorImageEdit({plan,userId:"7",variant:"sunburst",previewUrl:"https://test/preview.png",onJob});expect(jobs.createJobSameOrigin.mock.calls[1][0].input.params).toMatchObject({openaiImageVariant:"sunburst",referenceImageUrls:[source.url,"https://test/preview.png"]});
 await runAdvisorImageEdit({plan,userId:"7",variant:"sunburst",previewUrl:"https://test/preview.png",jobId:"j1",onJob});expect(jobs.createJobSameOrigin).toHaveBeenCalledTimes(2);expect(jobs.pollJobUntilTerminal.mock.calls.at(-1)?.[0]).toBe("j1");
});
it("旧源图/跨作品/模型伪造批准/过长视频指令不可自动通过",()=>{
 expect(()=>assertAdvisorMediaSource(plan,[{...source,revision:"b"}])).toThrow("变化");expect(()=>assertAdvisorMediaSource(plan,[])).toThrow();
 expect(()=>prepareAdvisorMediaPlan({...plan,approved:true},[source])).toThrow();
 expect(()=>prepareAdvisorMediaPlan({kind:"video",blockId:"v",instruction:"a".repeat(241)},[{...source,kind:"video",blockId:"v"}])).toThrow();
});

it("1005供应商结果未知不能标成可重新下单的失败",async()=>{
 jobs.createJobSameOrigin.mockClear();jobs.pollJobUntilTerminal.mockResolvedValue({status:"failed",error:"出图结果无法确认，转人工对账"});
 const error=await runAdvisorImageEdit({plan,userId:"7",variant:"flare",jobId:"existing",onJob:vi.fn()}).catch(e=>e);
 expect(error.terminal).toBe(false);expect(jobs.createJobSameOrigin).not.toHaveBeenCalled();
});
