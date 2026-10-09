import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversionJob } from "./fileConversionRepository";
const m=vi.hoisted(()=>({claim:vi.fn(),recover:vi.fn(),defer:vi.fn(),complete:vi.fn(),execute:vi.fn(),save:vi.fn(),settle:vi.fn(),mark:vi.fn(),refund:vi.fn()}));
vi.mock("./fileConversionRepository",()=>({claimConversionJob:m.claim,conversionRecoveryJobs:m.recover,deferConversionReceipt:m.defer,completeConversionReceipt:m.complete,
 heartbeatConversion:async()=>({cancelRequested:false}),bindConversionSource:vi.fn(),recoverConversionTerminal:vi.fn(),settleFreeConversion:m.settle,markConversionSettled:m.mark}));
vi.mock("../services/fileConversion",()=>({executeFileConversion:m.execute}));
vi.mock("../services/fileConversionStorage",()=>({saveConversionReceipt:m.save,readConversionReceipt:vi.fn()}));
vi.mock("../services/postProdResources",()=>({withPostProdResources:async(_id:any,signal:any,_meta:any,work:any)=>work(signal)}));
vi.mock("./workerRole",()=>({resolveJobWorkerRole:()=>"app"}));
vi.mock("../credits",()=>({refundChargeByKey:m.refund,deductCreditsAmount:vi.fn()}));
import { startFileConversionWorker,stopFileConversionWorker,drainFileConversions,fileConversionsBusy,processFileConversionOnce } from "./fileConversionWorker";
const output={type:"converted",objectName:"file-conversion/u7/results/test/test.txt",bytes:12};
const job=(id:string)=>({id,userId:"7",lane:"free",status:"running",input:{kind:"file_conversion",phase:"convert"},owner:"test"}) as ConversionJob;
beforeEach(()=>{vi.clearAllMocks();m.recover.mockResolvedValue([]);m.claim.mockResolvedValue(null);m.execute.mockResolvedValue(output);
 m.defer.mockImplementation(async(j,out,error)=>({...j,status:"receipt_pending",output:out,error}));m.complete.mockImplementation(async j=>({...j,status:j.cancelRequested?"failed":"succeeded"}));});
afterEach(async()=>{await drainFileConversions();stopFileConversionWorker();});
it("F1：执行完整process，永久回执持续失败也释放active与下一任务，不重做",async()=>{
 const first=job("first"),second=job("second");m.claim.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
 m.save.mockRejectedValue(new Error("测试GCS和网站都故障"));startFileConversionWorker();
 await vi.waitFor(()=>{expect(m.defer).toHaveBeenCalledTimes(1);expect(fileConversionsBusy()).toBe(false);});
 const pending=m.defer.mock.results[0].value;const saved=await pending;
 expect(saved.output).toEqual(output);m.recover.mockResolvedValue([saved]);await processFileConversionOnce();
 expect(m.execute).toHaveBeenCalledTimes(2);expect(m.claim).toHaveBeenCalledTimes(2);expect(m.defer).toHaveBeenCalledTimes(2);
 m.save.mockResolvedValue({storage:"gcs"});m.claim.mockResolvedValue(null);m.recover.mockResolvedValue([{...saved,cancelRequested:true}]);
 await processFileConversionOnce();expect(m.complete).toHaveBeenCalledWith(expect.objectContaining({id:"first",output,cancelRequested:true}));
 expect(m.settle).toHaveBeenCalledWith(expect.objectContaining({status:"failed"}));expect(m.execute).toHaveBeenCalledTimes(2);
});
it("F1：drain中断归档等待，DB待回执保留，退出不再领任务",async()=>{
 m.claim.mockResolvedValueOnce(job("drain"));m.save.mockImplementation((_id,_user,_out,signal:AbortSignal)=>new Promise((_,reject)=>{
  if(signal.aborted)reject(signal.reason);else signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
 }));startFileConversionWorker();await vi.waitFor(()=>expect(m.save).toHaveBeenCalledTimes(1));
 await drainFileConversions();expect(fileConversionsBusy()).toBe(false);expect(m.defer).toHaveBeenCalledWith(expect.anything(),output,undefined);
 await processFileConversionOnce();expect(m.execute).toHaveBeenCalledTimes(1);
});
it("F1：恢复旧待回执时drain也可退出，不占active且不重新转换",async()=>{
 m.recover.mockResolvedValue([{...job("recover-drain"),status:"receipt_pending",output}]);
 m.save.mockImplementation((_id,_user,_out,signal:AbortSignal)=>new Promise((_,reject)=>{signal.addEventListener("abort",()=>reject(signal.reason),{once:true});}));
 startFileConversionWorker();await vi.waitFor(()=>expect(m.save).toHaveBeenCalledTimes(1));await drainFileConversions();
 expect(fileConversionsBusy()).toBe(false);expect(m.execute).not.toHaveBeenCalled();expect(m.claim).not.toHaveBeenCalled();
});
