import {afterEach,expect,it,vi} from "vitest";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
const h=vi.hoisted(()=>({refund:vi.fn()}));
vi.mock("../credits",()=>({refundCredits:h.refund,refundCreditsForDeductAmount:h.refund}));
let dir="";const prior=process.env.PAID_JOB_LEDGER_DIR;
afterEach(async()=>{if(prior)process.env.PAID_JOB_LEDGER_DIR=prior;else delete process.env.PAID_JOB_LEDGER_DIR;await rm(dir,{recursive:true,force:true});});
it("edit settlement pending survives process registration and overdue reaper without a full refund",async()=>{
 dir=await mkdtemp(path.join(tmpdir(),"ink-edit-ledger-"));process.env.PAID_JOB_LEDGER_DIR=dir;vi.resetModules();
 const ledger=await import("./paidJobLedger");
 const input={jobId:"cv_edit_pending",taskType:"canvasVideo",userId:7,creditsBilled:44,action:"edit",resumable:true};
 await ledger.registerActiveJob(input);expect(await ledger.markSettlementPending(input.jobId,input.taskType)).toBe(true);
 await ledger.registerActiveJob(input);expect((await ledger.readActiveJob(input.jobId,input.taskType))?.status).toBe("settlement_pending");
 const file=path.join(dir,"canvasVideo","cv_edit_pending.json"),hold=JSON.parse(await readFile(file,"utf8"));hold.lastHeartbeatAt=new Date(Date.now()-48*3600000).toISOString();await writeFile(file,JSON.stringify(hold));
 await ledger.reapStuckPaidJobs();expect(h.refund).not.toHaveBeenCalled();expect((await ledger.readActiveJob(input.jobId,input.taskType))?.status).toBe("settled");
});
