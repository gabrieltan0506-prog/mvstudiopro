import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({deduct:vi.fn(),directRefund:vi.fn(),register:vi.fn(),settle:vi.fn(),pending:vi.fn(),refund:vi.fn(),heartbeat:vi.fn()}));
vi.mock("../credits",()=>({deductCreditsAmount:m.deduct,refundCreditsForDeductAmount:m.directRefund}));
vi.mock("./paidJobLedger",()=>({canonicalRefundKey:(t:string,id:string)=>`${t}/${id}`,registerActiveJob:m.register,unregisterActiveJob:m.settle,markSettlementPending:m.pending,refundCreditsOnFailure:m.refund,heartbeatActiveJob:m.heartbeat}));
import {withTopicShortlistCharge} from "./platformTopicShortlistBilling";
const input={userId:1,cost:12,count:3,exempt:false};
beforeEach(()=>{vi.resetAllMocks();m.deduct.mockResolvedValue({success:true,cost:12,source:"team",teamId:42});m.settle.mockResolvedValue({ok:true});m.register.mockResolvedValue(undefined);m.refund.mockResolvedValue({refunded:true});});
it("成功只扣一次并保留团队扣费来源，完整结果原样返回",async()=>{
 const result={topics:[{conveyGoal:"完整正文。".repeat(500)}]};
 expect(await withTopicShortlistCharge(input,async()=>result)).toBe(result);
 expect(m.deduct).toHaveBeenCalledTimes(1);expect(m.register.mock.calls[0][0].deduct.teamId).toBe(42);expect(m.refund).not.toHaveBeenCalled();expect(m.settle).toHaveBeenCalledTimes(1);
});
it("残缺结果失败沿原任务同源退还，不返回半篇",async()=>{
 await expect(withTopicShortlistCharge(input,async()=>{throw Error("选题未完整结束");})).rejects.toThrow("未完整结束");
 expect(m.refund).toHaveBeenCalledTimes(1);expect(m.settle).not.toHaveBeenCalled();expect(m.refund.mock.calls[0][0]).toBe(m.register.mock.calls[0][0].jobId);
});
it("账本登记失败先退还且不调用模型",async()=>{
 m.register.mockRejectedValue(Error("持久化失败"));const work=vi.fn();
 await expect(withTopicShortlistCharge(input,work)).rejects.toThrow("持久化失败");
 expect(work).not.toHaveBeenCalled();expect(m.directRefund).toHaveBeenCalledTimes(1);expect(m.directRefund.mock.calls[0][2].teamId).toBe(42);
});
it("成功结算写入失败只进入待结算，不误退",async()=>{
 m.settle.mockRejectedValue(Error("暂不可写"));expect(await withTopicShortlistCharge(input,async()=>"完整结果")).toBe("完整结果");expect(m.pending).toHaveBeenCalledTimes(1);expect(m.refund).not.toHaveBeenCalled();
});
it("管理员保持免扣",async()=>{expect(await withTopicShortlistCharge({...input,exempt:true},async()=>"完整结果")).toBe("完整结果");expect(m.deduct).not.toHaveBeenCalled();expect(m.register).not.toHaveBeenCalled();});
