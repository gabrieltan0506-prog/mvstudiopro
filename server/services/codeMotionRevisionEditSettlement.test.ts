import {beforeEach,expect,it,vi} from "vitest";
const h=vi.hoisted(()=>({files:new Map<string,Buffer>(),duration:4.7,hold:"active",failWrite:false,refunds:new Set<string>(),refunded:0,events:[] as string[]}));
vi.mock("./codeMotionStore",()=>({codeMotionStorage:{read:async(n:string)=>h.files.has(n)?{body:h.files.get(n),generation:"1"}:null,write:async(n:string,b:Buffer)=>{if(n.endsWith("cost-settlement.json")&&h.failWrite){h.failWrite=false;throw Error("receipt storage unavailable");}if(h.files.has(n))throw Error("CAS");h.files.set(n,b);return "1";}}}));
vi.mock("./codeMotionRevisionEdit",async original=>({...await original<any>(),inspectCodeMotionEditVideo:async()=>({sha256:"d".repeat(64),duration:h.duration,width:1280,height:720,raw:"{}"})}));
vi.mock("./paidJobLedger",()=>({readActiveJob:async()=>({status:h.hold}),markSettlementPending:async()=>{h.events.push("seal");h.hold="settlement_pending";return true;}}));
vi.mock("../credits",()=>({getUserPlan:async()=>"pro",refundCreditsForDeductAmount:vi.fn(async(_u:number,_reason:string,deduct:any,_label:string,opts:any)=>{h.events.push("refund");expect(h.hold).toBe("settlement_pending");if(!h.refunds.has(opts.refundKey)){h.refunds.add(opts.refundKey);h.refunded+=deduct.cost;}expect(deduct.source).toBe("team");expect(deduct.teamId).toBe(9);})}));
import {settleCodeMotionVideoEdit} from "./codeMotionRevisionEditSettlement";
import {editVideoCost,REVISION_EDIT_RATE} from "./codeMotionRevisionEdit";
const task={taskId:"cv_edit_test",userId:7,engine:"seedance25-evolink",evolinkTaskId:"up-original",creditsCharged:44,label:"edit",deduct:{source:"team",teamId:9,teamMemberId:11},inkProduction:{projectId:"child",index:1}} as any;
const quote={fingerprint:"quote",rate:REVISION_EDIT_RATE,basis:"published_rate_measured_units",credits:44,shot:{version:"2.5",mode:"video_edit",editSource:{inputDuration:5,asset:{sha256:"a".repeat(64)}}}} as any;
beforeEach(()=>{h.files.clear();h.refunds.clear();h.duration=4.7;h.hold="active";h.failWrite=false;h.refunded=0;h.events=[];});
it("uses actual input/output units and one same-source refund across receipt-write crash recovery",async()=>{
 expect(editVideoCost(5,4.7)).toMatchObject({costUsd:1.9206,credits:43,billableInputSeconds:5,billableOutputSeconds:4.7});
 h.failWrite=true;
 await expect(settleCodeMotionVideoEdit(task,quote,'{"status":"completed"}',"https://output")).rejects.toThrow("unavailable");
 expect(h.refunded).toBe(1);expect(h.events.slice(0,2)).toEqual(["seal","refund"]);
 await settleCodeMotionVideoEdit(task,quote,'{"status":"completed"}',"https://output");
 await settleCodeMotionVideoEdit(task,quote,'{"status":"completed"}',"https://output");
 expect(h.refunded).toBe(1);
 const receipt=JSON.parse(h.files.get("code-motion/u7/production/child/video-evidence/1/cost-settlement.json")!.toString());
 expect(receipt).toMatchObject({creditsReserved:44,creditsRefunded:1,creditsCharged:43,costUsd:1.9206,providerDebitVerified:false,status:"settled"});
});
it("unverified/refunded source and cost above confirmed ceiling cannot be called settled",async()=>{
 h.hold="refunded";await expect(settleCodeMotionVideoEdit(task,quote,"{}","https://output")).rejects.toThrow("原扣款");expect(h.refunded).toBe(0);
 h.files.clear();h.hold="active";h.duration=8.1;
 await settleCodeMotionVideoEdit(task,quote,"{}","https://output");expect(h.refunded).toBe(0);
 const receipt=JSON.parse(h.files.get("code-motion/u7/production/child/video-evidence/1/cost-settlement.json")!.toString());expect(receipt).toMatchObject({status:"pending_cost",creditsCharged:44,creditsRefunded:0});expect(receipt.creditsRequiredByMeasuredUnits).toBeGreaterThan(44);expect(h.hold).toBe("settlement_pending");
});
