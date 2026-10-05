import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ call: vi.fn(), create: vi.fn(), resolve: vi.fn(), format: vi.fn(), charge: vi.fn(), refund: vi.fn(), generic: vi.fn() }));
vi.mock("./manhuaWriterModelRun", () => ({ createManhuaWriterModelCall: m.create }));
vi.mock("./manhuaViralTemplateStore.js", () => ({ resolveViralTemplateForExpand: m.resolve }));
vi.mock("../../shared/manhuaViralTemplateBank.js", async original => ({ ...await original<typeof import("../../shared/manhuaViralTemplateBank")>(), formatManhuaViralTemplateWriterSkillFromCard: m.format }));
vi.mock("../credits", () => ({ getCredits: async () => ({totalAvailable: 1000}), deductCredits: m.charge, refundCredits: m.refund }));
vi.mock("./platformOptimizeCustomCopy", () => ({ optimizeCustomCopy: m.generic, OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE: "capacity" }));
import { runOptimizeCustomCopyForUser } from "./optimizeCopyRouteRun";
const plans = ["mt_ab12", "mt_cd34", "mt_ef56"].map(publicId => ({publicId, reason:`${publicId}适合本集的特色`, changes:["改变试探节奏", "用人物动作体现关系"], preserve:"保留原稿核心因果"}));
const input = {sourceText:"本集确认正文与原分镜表合同",storyboardCandidate:true,writerModel:"glm" as const,publicTemplateId:"mt_ab12",templateReferences:plans};
beforeEach(() => { vi.clearAllMocks(); m.refund.mockResolvedValue(undefined); m.create.mockReturnValue(m.call); m.call.mockResolvedValue({text:"完整分镜原文",model:"selected"}); m.resolve.mockImplementation(async publicId => ({card:{id:publicId},appliedTemplate:{publicId,nameZh:publicId.slice(3).toUpperCase()}})); m.format.mockImplementation(card=>`真实模板${card.id}的灯光与动作方法`); });
it.each(["glm","deepseek"] as const)("%s消费本集3份真实模板和顾问特色及原模型函数，不走Kimi", async writerModel => {
 const heartbeat=vi.fn(); const result=await runOptimizeCustomCopyForUser({...input,writerModel},{id:7,role:"user"},heartbeat);
 expect(m.create).toHaveBeenCalledWith(7,expect.any(String),writerModel);
 expect(m.resolve.mock.calls.map(([id])=>id)).toEqual(plans.map(p=>p.publicId));
 for(const plan of plans) { expect(m.format).toHaveBeenCalledWith({id:plan.publicId}); expect(m.call.mock.calls[0][0]).toContain(`真实模板${plan.publicId}的灯光与动作方法`); expect(m.call.mock.calls[0][0]).toContain(plan.reason); }
 expect(m.call).toHaveBeenCalledWith(expect.stringContaining("保留原稿核心因果"),false,"storyboard",{onBytes:heartbeat});
 expect(m.call.mock.calls[0][0]).toContain(input.sourceText);
 expect(result.result.optimizedMarkdown).toBe("完整分镜原文"); expect(result.appliedTemplates?.map(t=>t.publicId)).toEqual(plans.map(p=>p.publicId));
 expect(result.appliedTemplates?.every(t=>/^[a-f0-9]{64}$/.test(t.capabilitySha256))).toBe(true);
 expect(m.generic).not.toHaveBeenCalled(); expect(m.charge).toHaveBeenCalledTimes(1);
});
it("缺失模型或只有旧单模板/模板下架时不扣费也不调用模型",async()=>{
 await expect(runOptimizeCustomCopyForUser({...input,writerModel:undefined},{id:7,role:"user"})).rejects.toThrow();
 await expect(runOptimizeCustomCopyForUser({...input,templateReferences:undefined},{id:7,role:"user"})).rejects.toThrow("3–5");
 m.resolve.mockResolvedValue({error:"not_found"});
 await expect(runOptimizeCustomCopyForUser(input,{id:7,role:"user"})).rejects.toThrow("模板不可用");
 expect(m.charge).not.toHaveBeenCalled();expect(m.call).not.toHaveBeenCalled();expect(m.generic).not.toHaveBeenCalled();
});

it.each([2,6])("%s份方案明确拒绝，不截断也不扣费",async count=>{
 const templateReferences=Array.from({length:count},(_,i)=>({...plans[0],publicId:`mt_a00${i}`}));
 await expect(runOptimizeCustomCopyForUser({...input,templateReferences},{id:7,role:"user"})).rejects.toThrow("3–5");
 expect(m.resolve).not.toHaveBeenCalled();expect(m.charge).not.toHaveBeenCalled();expect(m.call).not.toHaveBeenCalled();
});
it("5份真实模板完整消费，空能力和重复编号均在扣费前拒绝",async()=>{
 const templateReferences=[...plans,{...plans[0],publicId:"mt_1000"},{...plans[0],publicId:"mt_2000"}];
 const result=await runOptimizeCustomCopyForUser({...input,templateReferences,publicTemplateId:undefined},{id:7,role:"user"});
 expect(result.appliedTemplates).toHaveLength(5);
 expect(m.call.mock.calls[0][0]).toContain("真实模板mt_2000的灯光与动作方法");
 m.charge.mockClear();m.call.mockClear();m.resolve.mockClear();
 await expect(runOptimizeCustomCopyForUser({...input,templateReferences:[plans[0],plans[1],{...plans[0],publicId:"MT_AB12"}]},{id:7,role:"user"})).rejects.toThrow("重复");
 expect(m.resolve).not.toHaveBeenCalled();
 m.format.mockReturnValueOnce("");
 await expect(runOptimizeCustomCopyForUser(input,{id:7,role:"user"})).rejects.toThrow("缺少");
 expect(m.charge).not.toHaveBeenCalled();expect(m.call).not.toHaveBeenCalled();
});
it("模型失联只保留失败，不暗换Kimi；沿原退款规则",async()=>{
 m.call.mockRejectedValue(new Error("流未完整结束"));
 await expect(runOptimizeCustomCopyForUser(input,{id:7,role:"user"})).rejects.toThrow("流未完整结束");
 expect(m.call).toHaveBeenCalledTimes(1);expect(m.generic).not.toHaveBeenCalled();expect(m.refund).toHaveBeenCalledTimes(1);
});

it.each(["story","assets","beats"] as const)("原%s节点无模板仍用所选模型，不错误强制正式分镜门禁",async factoryTextStage=>{
 const result=await runOptimizeCustomCopyForUser({...input,storyboardCandidate:undefined,factoryTextStage,templateReferences:undefined,publicTemplateId:undefined},{id:7,role:"user"});
 expect(m.create).toHaveBeenCalledWith(7,expect.any(String),"glm");
 expect(m.call).toHaveBeenCalledWith(expect.stringContaining(input.sourceText),false,factoryTextStage,{onBytes:undefined});
 expect(m.resolve).not.toHaveBeenCalled();expect(m.generic).not.toHaveBeenCalled();
 expect(result.result.optimizedMarkdown).toBe("完整分镜原文");
 expect(m.call.mock.calls[0][0]).not.toContain("原分镜表合同返回");
});
it("原资产节点若携带模板则逐份校验消费，失败不退Kimi",async()=>{
 m.call.mockRejectedValueOnce(new Error("首选模型未完整返回"));
 await expect(runOptimizeCustomCopyForUser({...input,storyboardCandidate:undefined,factoryTextStage:"assets"},{id:7,role:"user"})).rejects.toThrow("未完整返回");
 expect(m.resolve).toHaveBeenCalledTimes(3);expect(m.call).toHaveBeenCalledTimes(1);expect(m.generic).not.toHaveBeenCalled();expect(m.refund).toHaveBeenCalledTimes(1);
 m.charge.mockClear();m.call.mockClear();
 await expect(runOptimizeCustomCopyForUser({...input,storyboardCandidate:undefined,factoryTextStage:"assets",templateReferences:[]},{id:7,role:"user"})).rejects.toThrow("3–5");
 expect(m.charge).not.toHaveBeenCalled();expect(m.call).not.toHaveBeenCalled();
});
