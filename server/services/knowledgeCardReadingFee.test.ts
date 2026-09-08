import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ objects: new Map<string, any>(), deduct: vi.fn(), save: vi.fn(), readCharge: vi.fn() }));
vi.mock("../credits.js", () => ({ deductCreditsAmount: m.deduct, readCreditsChargeByKey: m.readCharge }));
vi.mock("./knowledgeCardReading.js", () => ({ KNOWLEDGE_CARD_READING_CONTRACT: "reading-test-v1" }));
vi.mock("./knowledgeCardReadingStore.js", async original => ({ ...await original<typeof import("./knowledgeCardReadingStore")>(),
  readKnowledgeReadingJson: async (name: string) => m.objects.get(name) ?? null, saveKnowledgeReadingObject: m.save,
}));
import { settleKnowledgeCardReadingFee } from "./knowledgeCardReadingFee";
const input = () => ({ userId: 7, analysisId: "a".repeat(64), model: "gpt-5.6-sol" as const, chargeDistillFee: true });
beforeEach(() => {
  vi.clearAllMocks(); m.objects.clear();
  m.readCharge.mockResolvedValue(null);
  m.deduct.mockImplementation(async (_user: number, cost: number) => ({ cost, source: "personal" }));
  m.save.mockImplementation(async (name: string, data: Buffer) => { m.objects.set(name, JSON.parse(data.toString())); });
});
describe("精读沿用主动提炼费与固定扣费身份", () => {
  it.each([["gpt-5.6-sol", 50], ["qwen3.8-max", 30]] as const)("%s沿用%s积分，同一阅读再查不再次扣费", async (model, cost) => {
    expect(await settleKnowledgeCardReadingFee({ ...input(), model })).toBe(cost);
    expect(await settleKnowledgeCardReadingFee({ ...input(), model })).toBe(cost);
    expect(m.deduct).toHaveBeenCalledTimes(1);
    expect(m.deduct).toHaveBeenCalledWith(7, cost, "knowledgeCardDistill", expect.any(String), { chargeKey: `knowledgeCardReading/7/${input().analysisId}` });
  });
  it("没有明确确认不扣费也不写付费回执", async () => {
    expect(await settleKnowledgeCardReadingFee({ ...input(), chargeDistillFee: false })).toBe(0);
    expect(m.deduct).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled();
    expect(m.readCharge).not.toHaveBeenCalled();
  });
  it.each(["personal", "team"])("%s原账已扣且余额不足时直接恢复费用记录，不再请求扣减", async source => {
    m.save.mockRejectedValueOnce(new Error("存储失败"));
    await expect(settleKnowledgeCardReadingFee(input())).rejects.toThrow("存储失败");
    m.readCharge.mockResolvedValue({ cost: 50, source });
    m.deduct.mockRejectedValue(new Error("余额不足，不能再次扣费"));
    expect(await settleKnowledgeCardReadingFee(input())).toBe(50);
    expect(m.deduct).toHaveBeenCalledTimes(1);
    expect(m.readCharge).toHaveBeenLastCalledWith(7, `knowledgeCardReading/7/${input().analysisId}`);
    expect(Array.from(m.objects.values())).toEqual([{ credits: 50 }]);
  });
  it("原账查询失败时停止，不把未知原账当成未扣再收费", async () => {
    m.readCharge.mockRejectedValue(new Error("账本查询不可用"));
    await expect(settleKnowledgeCardReadingFee(input())).rejects.toThrow("账本查询不可用");
    expect(m.deduct).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled();
  });
  it("首次扣费后存储失败，重试按相同chargeKey恢复原金额而非记0", async () => {
    m.save.mockRejectedValueOnce(new Error("存储失败"));
    await expect(settleKnowledgeCardReadingFee(input())).rejects.toThrow("存储失败");
    m.deduct.mockResolvedValueOnce({ cost: 50, source: "personal", alreadyCharged: true });
    expect(await settleKnowledgeCardReadingFee(input())).toBe(50);
    expect(m.deduct.mock.calls[0]![4]).toEqual(m.deduct.mock.calls[1]![4]);
    expect(Array.from(m.objects.values())).toEqual([{ credits: 50 }]);
  });
  it("管理员真实0扣回执保存0，不能虚报收费50", async () => {
    m.deduct.mockResolvedValue({ cost: 0, source: "admin" });
    expect(await settleKnowledgeCardReadingFee(input())).toBe(0);
    expect(await settleKnowledgeCardReadingFee(input())).toBe(0);
    expect(m.deduct).toHaveBeenCalledTimes(1);
  });
  it("余额不足或扣款结果未知不落成功费用回执", async () => {
    m.deduct.mockRejectedValue(new Error("扣费暂不可确认"));
    await expect(settleKnowledgeCardReadingFee(input())).rejects.toThrow("不可确认");
    expect(m.save).not.toHaveBeenCalled();
  });
  it("非法阅读身份在扣费前拒绝", async () => {
    await expect(settleKnowledgeCardReadingFee({ ...input(), analysisId: "../other" })).rejects.toThrow("身份");
    expect(m.deduct).not.toHaveBeenCalled();
  });
});
