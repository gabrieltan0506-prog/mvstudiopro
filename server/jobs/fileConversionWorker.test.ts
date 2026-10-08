import {beforeEach,describe,expect,it,vi} from "vitest";
import type {ConversionJob} from "./fileConversionRepository";
import {conversionBilling} from "../../shared/fileConversion";
const m=vi.hoisted(()=>({deduct:vi.fn(),refund:vi.fn(),settle:vi.fn(),mark:vi.fn()}));
vi.mock("../credits",()=>({deductCreditsAmount:m.deduct,refundChargeByKey:m.refund}));
vi.mock("./fileConversionRepository",()=>({settleFreeConversion:m.settle,markConversionSettled:m.mark}));
vi.mock("../services/fileConversion",()=>({executeFileConversion:vi.fn()}));
vi.mock("../services/heavyMediaEvidence",()=>({readHeavyMediaResult:vi.fn(),saveHeavyMediaResult:vi.fn()}));
vi.mock("../services/postProdResources",()=>({withPostProdResources:vi.fn()}));
import{chargeConversionJob,settleConversionJob}from"./fileConversionWorker";
const pricing={version:"test-only",standardCredits:1,scanCreditsPerMb:1};
const job=()=>({id:"conv_test",userId:"7",lane:"paid",status:"running",input:{kind:"file_conversion",phase:"convert",quote:{credits:2,pricingVersion:"test-only"}}}) as ConversionJob;
beforeEach(()=>{vi.clearAllMocks();m.deduct.mockResolvedValue({success:true});m.refund.mockResolvedValue({refunded:true});});
describe("转换积分结算",()=>{
 it("扣款只用真实报价，原文件MB向上取整，同任务恒定幂等键",async()=>{const bill=conversionBilling(1_000_001,true,"paid",pricing);await chargeConversionJob(job(),bill);await chargeConversionJob(job(),bill);expect(m.deduct).toHaveBeenCalledTimes(2);expect(m.deduct.mock.calls[0]).toEqual(m.deduct.mock.calls[1]);expect(m.deduct).toHaveBeenCalledWith(7,2,"fileConversion",expect.any(String),{chargeKey:"fileConversion/conv_test"});});
 it("未确认涨价/变版、积分不足拒绝；免费与检查不扣费",async()=>{await expect(chargeConversionJob(job(),conversionBilling(1,false,"paid",pricing))).rejects.toThrow("报价");expect(m.deduct).not.toHaveBeenCalled();m.deduct.mockResolvedValue({success:false});await expect(chargeConversionJob(job(),conversionBilling(1_000_001,true,"paid",pricing))).rejects.toThrow("积分不足");await chargeConversionJob({...job(),lane:"free"},conversionBilling(1,false));expect(m.deduct).toHaveBeenCalledTimes(1);});
 it("失败/取消/拒绝按原扣款来源退款，成功不退款",async()=>{await settleConversionJob({...job(),status:"failed"});expect(m.refund).toHaveBeenCalledWith(expect.objectContaining({userId:7,chargeKey:"fileConversion/conv_test",refundKey:"fileConversionRefund/conv_test"}));m.refund.mockClear();await settleConversionJob({...job(),status:"succeeded",output:{type:"converted"} as any});expect(m.refund).not.toHaveBeenCalled();});
 it("退款故障保留refund_pending供同任务恢复，不能当成功结算",async()=>{m.refund.mockRejectedValue(new Error("test db unavailable"));await expect(settleConversionJob({...job(),status:"failed"})).rejects.toThrow();expect(m.mark).toHaveBeenCalledWith(expect.objectContaining({id:"conv_test"}),true);expect(m.mark).toHaveBeenCalledTimes(1);});
});
