import {describe,it,expect,vi} from "vitest";
import {createKnowledgeReadingController} from "./knowledgeReadingPreparation";
const link={jobId:"kc_test",documentId:"11111111-1111-4111-a111-111111111111",batches:2};
it("读档未结束就整理已齐分段，最多两路、同一ID不重复提交",async()=>{
 const execute=vi.fn(async(..._args:any[])=>({creditsCharged:12})),state=vi.fn(async()=>({...link,status:"running",ready:[0],completed:[] as number[],failed:[] as number[],paidUnit:12,maxCredits:24,estimatedCredits:24}));
 const controller=createKnowledgeReadingController({state,execute,confirm:async()=>true,progress:vi.fn()});
 await controller.update({...link,ready:[0]});await new Promise(r=>setTimeout(r,0));
 expect(execute).toHaveBeenCalledTimes(1);
 await controller.update({...link,ready:[0]});expect(execute).toHaveBeenCalledTimes(1);
 state.mockResolvedValue({...link,status:"succeeded",ready:[0,1],completed:[0],failed:[],paidUnit:12,maxCredits:12,estimatedCredits:12});
 await controller.update({...link,ready:[0,1]});await controller.wait();expect(execute).toHaveBeenCalledTimes(2);
 expect(execute.mock.calls[0][2]).not.toBe(execute.mock.calls[1][2]);
});
it("未确认时不请求顾问，失败不自动新建问答",async()=>{
 const state=async()=>({...link,status:"running",ready:[0,1],completed:[] as number[],failed:[] as number[],paidUnit:12,maxCredits:24,estimatedCredits:24}),execute=vi.fn(async(..._args:any[])=>({creditsCharged:12}));
 const controller=createKnowledgeReadingController({state,execute,confirm:async()=>false,progress:vi.fn()});
 await controller.update({...link,ready:[0,1]});await controller.wait();expect(execute).not.toHaveBeenCalled();expect(controller.link()).toBeUndefined();
});

it("请求发出即显示处理中，真实返回后动态展示正文，不要求再次手动启动",async()=>{
 let done!:()=>void;
 const content=vi.fn(),progress=vi.fn();
 const saved=[{index:0,pages:[{headline:"已整理的标题",body:"真实完整正文及最后一句"}]}];
 let finished=false;
 const state=async()=>({...link,batches:1,status:"running",ready:[0],completed:finished?[0]:[],failed:[],paidUnit:12,maxCredits:12,estimatedCredits:12,drafts:finished?saved:[]});
 const controller=createKnowledgeReadingController({state,content,progress,confirm:async()=>true,execute:async()=>{await new Promise<void>(r=>done=r);finished=true;return {creditsCharged:12};}});
 await controller.update({...link,batches:1,ready:[0]});
 expect(progress.mock.calls.some(([message])=>message.includes("正在整理已读取的内容"))).toBe(true);
 expect(content).not.toHaveBeenCalledWith(saved);
 done();await controller.wait();expect(content).toHaveBeenCalledWith(saved);
});

it("后续文件新增范围先确认，拒绝后不发新请求，已有结果保留",async()=>{
 const execute=vi.fn(async()=>({creditsCharged:12}));let expanded=false;
 const state=async()=>({...link,batches:expanded?2:1,status:"running",ready:expanded?[0,1]:[0],completed:expanded?[0]:[],failed:[],paidUnit:12,maxCredits:12,estimatedCredits:12});
 const confirm=vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
 const controller=createKnowledgeReadingController({state,execute,confirm,progress:vi.fn()});
 await controller.update({...link,batches:1,ready:[0]});await controller.wait();
 expanded=true;await controller.update({...link,batches:2,ready:[0,1]});await controller.wait();
 expect(confirm).toHaveBeenCalledTimes(2);expect(execute).toHaveBeenCalledTimes(1);
});
