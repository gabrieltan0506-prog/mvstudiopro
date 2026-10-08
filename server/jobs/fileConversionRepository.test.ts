import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { FileConversionRequest } from "../../shared/fileConversion";
const state=vi.hoisted(()=>({db:null as any}));vi.mock("../db",()=>({getDb:async()=>state.db}));
import { enqueueConversionJob,ensureConversionTables,freeConversionQuota,claimConversionJob,finishConversionJob,settleFreeConversion,cancelConversionJob,getConversionJob,conversionAhead,heartbeatConversion,conversionRecoveryJobs, markConversionSettled, deferConversionReceipt, completeConversionReceipt } from "./fileConversionRepository";
const pg=new PGlite();
const request=(n:number,changes:Partial<FileConversionRequest>={}):FileConversionRequest=>({kind:"file_conversion",phase:"inspect",formatId:"txt-docx",lane:"free",day:"2026-10-09",ipHash:"a".repeat(64),source:{objectName:`file-conversion/u7/sources/file${n}`,fileName:"test.txt",bytes:12,generation:"1",sha256:String(n).padStart(64,"0")},...changes});
beforeAll(async()=>{state.db=drizzle(pg);await ensureConversionTables(state.db);},30000);
beforeEach(async()=>{await pg.exec("TRUNCATE file_conversion_jobs,file_conversion_free_slots,file_conversion_free_ip_slots");});afterAll(()=>pg.close());
describe("真实Postgres双维额度与持久队列",()=>{
 it("同一请求并发幂等，账号与IP均最多3个原文件",async()=>{await Promise.all(Array.from({length:5},()=>enqueueConversionJob("7",request(1))));expect((await freeConversionQuota("7","a".repeat(64),"2026-10-09")).remaining).toBe(2);const attempts=await Promise.allSettled([2,3,4,5].map(n=>enqueueConversionJob("7",request(n))));expect(attempts.filter(x=>x.status==="fulfilled")).toHaveLength(2);await expect(enqueueConversionJob("8",request(6))).rejects.toThrow("今日免费转换已达上限");expect((await pg.query("SELECT * FROM file_conversion_jobs")).rows).toHaveLength(3);});
 it("换IP仍受账号限制，换账号仍受IP限制，翌日恢复",async()=>{for(let n=1;n<=3;n++)await enqueueConversionJob("7",request(n));await expect(enqueueConversionJob("7",request(4,{ipHash:"b".repeat(64)}))).rejects.toThrow("今日免费");await expect(enqueueConversionJob("8",request(5))).rejects.toThrow("今日免费");expect((await freeConversionQuota("7","a".repeat(64),"2026-10-10")).remaining).toBe(3);await enqueueConversionJob("7",request(1,{day:"2026-10-10"}));});
 it("同一SHA检查和多格式只占一个原件名额",async()=>{await enqueueConversionJob("7",request(1));await enqueueConversionJob("7",request(1,{phase:"convert"}));await enqueueConversionJob("7",request(1,{formatId:"pdf-txt"}));expect((await freeConversionQuota("7","a".repeat(64),"2026-10-09")).remaining).toBe(2);});
 it("两条车道独立且多执行者同车道只领一个",async()=>{await enqueueConversionJob("7",request(1));await enqueueConversionJob("7",request(2));await enqueueConversionJob("8",request(3,{lane:"paid"}));const jobs=await Promise.all([claimConversionJob("free","a"),claimConversionJob("free","b"),claimConversionJob("paid","c")]);expect(jobs.filter(Boolean)).toHaveLength(2);expect(jobs.filter(x=>x?.lane==="free")).toHaveLength(1);});
 it("失败释放，成功原子消耗，取消不会释放另一个同源在途任务",async()=>{const first=await enqueueConversionJob("7",request(1));await enqueueConversionJob("7",request(1,{phase:"convert"}));await cancelConversionJob((await getConversionJob(first.id))!);expect((await freeConversionQuota("7","a".repeat(64),"2026-10-09")).remaining).toBe(2);const running=(await claimConversionJob("free","a"))!;const terminal=await finishConversionJob(running,null,"test failure");await settleFreeConversion(terminal);expect((await freeConversionQuota("7","a".repeat(64),"2026-10-09")).remaining).toBe(3);await enqueueConversionJob("7",request(2,{phase:"convert"}));const ok=(await claimConversionJob("free","a"))!;await finishConversionJob(ok,{type:"converted",objectName:"test",fileName:"test.docx",mimeType:"test",bytes:12,sha256:"b".repeat(64),sourceSha256:ok.sourceSha!,credits:0});expect((await pg.query("SELECT consumed FROM file_conversion_free_slots")).rows).toEqual([{consumed:true}]);});
 it("前方人数去重并排除本人，活跃心跳不受总耗时影响",async()=>{await enqueueConversionJob("8",request(1));await enqueueConversionJob("8",request(2));const me=await enqueueConversionJob("7",request(3));await pg.exec(`UPDATE file_conversion_jobs SET "createdAt"=now()-interval '1 hour' WHERE "userId"='8'`);expect(await conversionAhead((await getConversionJob(me.id))!)).toBe(1);const running=(await claimConversionJob("free","a"))!;await pg.exec(`UPDATE file_conversion_jobs SET "createdAt"=now()-interval '2 hours',"updatedAt"=now()-interval '11 minutes' WHERE status='running'`);expect((await conversionRecoveryJobs("free")).some(x=>x.id===running.id)).toBe(true);await heartbeatConversion(running);expect((await conversionRecoveryJobs("free")).some(x=>x.id===running.id)).toBe(false);});
});

it("F4：失败结算后重复同请求不重新预约，返回旧failed",async()=>{
 const req=request(1,{phase:"convert"});const first=await enqueueConversionJob("7",req);
 const running=(await claimConversionJob("free","owner"))!;
 const failed=await finishConversionJob(running,null,"测试失败");await settleFreeConversion(failed);await markConversionSettled(failed);
 expect((await freeConversionQuota("7",req.ipHash!,req.day)).remaining).toBe(3);
 const repeat=await enqueueConversionJob("7",req);expect(repeat).toEqual({id:first.id,status:"failed"});
 expect((await freeConversionQuota("7",req.ipHash!,req.day)).remaining).toBe(3);
 expect(await claimConversionJob("free","next")).toBeNull();
});
it("F1：待回执持久结果释放running槽；取消保留产物，恢复不重排转换",async()=>{
 await enqueueConversionJob("7",request(1,{phase:"convert"}));await enqueueConversionJob("7",request(2));
 const running=(await claimConversionJob("free","owner"))!;
 const output={type:"converted" as const,objectName:"test",fileName:"test.docx",mimeType:"test",bytes:12,sha256:"b".repeat(64),sourceSha256:running.sourceSha!,credits:0};
 const pending=await deferConversionReceipt(running,output);expect(pending.status).toBe("receipt_pending");expect(pending.output).toEqual(output);
 expect((await claimConversionJob("free","next"))?.id).not.toBe(running.id);
 await cancelConversionJob(pending);
 const terminal=(await completeConversionReceipt(pending))!;expect(terminal.status).toBe("failed");expect(terminal.output).toEqual(output);
 await settleFreeConversion(terminal);await markConversionSettled(terminal);
 expect((await getConversionJob(running.id))?.input).toMatchObject({settled:true});
});

it("同SHA换到已满IP拒绝；可用IP另有绑定，账号仍只占一次",async()=>{
 const a="a".repeat(64),b="b".repeat(64),c="c".repeat(64);
 await enqueueConversionJob("7",request(1));
 for(let n=2;n<=4;n++)await enqueueConversionJob("8",request(n,{ipHash:b}));
 await expect(enqueueConversionJob("7",request(1,{phase:"convert",ipHash:b}))).rejects.toThrow("今日免费");
 await enqueueConversionJob("7",request(1,{phase:"convert",ipHash:c}));
 expect((await freeConversionQuota("7",a,"2026-10-09")).remaining).toBe(2);
 expect((await freeConversionQuota("9",c,"2026-10-09")).remaining).toBe(2);
});
