import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ receipt: vi.fn(), deduct: vi.fn(), rows: [] as unknown[], failDb: false }));
vi.mock("../db", () => ({ getDb: async () => deps.failDb ? null : ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => deps.rows }) }) }) }) }));
vi.mock("../credits", () => ({ deductCreditsAmount: deps.deduct }));
vi.mock("../services/knowledgeCardDistillReceipt", () => ({ recordKnowledgeCardDistillReceipt: deps.receipt }));
import { settleKnowledgeCardCheckpoint } from "./knowledgeCardSettlementRunner";
import { getKnowledgeCardSettlement, type KnowledgeCardSettlementCheckpoint } from "./repository";
const checkpoint: KnowledgeCardSettlementCheckpoint = {
  version: 1, fee: 25, receiptModel: "glm-5.3-flash", markdown: "## 真实保存的成稿\n这里是已经生成的正文。",
  output: { success: true, distilledMarkdown: "## 真实保存的成稿\n这里是已经生成的正文。", sourceChars: 1200, pageCount: 4 },
};
beforeEach(() => { deps.rows = []; deps.failDb = false; deps.receipt.mockReset().mockResolvedValue(undefined); deps.deduct.mockReset().mockResolvedValue({ cost: 25 }); });
describe("知识卡检查点只续结算", () => {
  it("消费原稿与档位，沿用原 chargeKey", async () => {
    const result = await settleKnowledgeCardCheckpoint("test-job", 1, checkpoint);
    expect(result).toEqual({ ...checkpoint.output, distillFeeCharged: 25 });
    expect(deps.receipt).toHaveBeenCalledWith(1, checkpoint.receiptModel, checkpoint.markdown);
    expect(deps.deduct).toHaveBeenCalledWith(1, 25, "knowledgeCardDistill", expect.any(String), { chargeKey: "[chargeKey:kcdistill/test-job]" });
  });
  it("扣费后恢复读取原账，不重复扣费", async () => {
    deps.rows = [{ creditsCost: 25 }];
    expect((await settleKnowledgeCardCheckpoint("test-job", 1, checkpoint)).distillFeeCharged).toBe(25);
    expect(deps.deduct).not.toHaveBeenCalled();
  });
  it("查账不可用不盲扣", async () => {
    deps.failDb = true;
    await expect(settleKnowledgeCardCheckpoint("test-job", 1, checkpoint)).rejects.toThrow("对账暂不可用");
    expect(deps.deduct).not.toHaveBeenCalled();
  });
  it("派生零费仍登记原稿，不触发账本", async () => {
    await settleKnowledgeCardCheckpoint("test-derive", 1, { ...checkpoint, fee: 0 });
    expect(deps.receipt).toHaveBeenCalledOnce();
    expect(deps.deduct).not.toHaveBeenCalled();
  });
  it("旧任务兼容，坏检查点不得当作无记录", () => {
    expect(getKnowledgeCardSettlement({ distillPercent: 98 })).toBeNull();
    expect(getKnowledgeCardSettlement({ knowledgeCardSettlement: checkpoint })).toEqual(checkpoint);
    expect(() => getKnowledgeCardSettlement({ knowledgeCardSettlement: { ...checkpoint, markdown: "不同稿" } })).toThrow();
  });
});
