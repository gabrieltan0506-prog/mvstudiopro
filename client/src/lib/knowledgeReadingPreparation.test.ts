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
