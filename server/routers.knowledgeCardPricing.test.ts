import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), credits: vi.fn(), deduct: vi.fn(), image: vi.fn() }));
vi.mock("./services/knowledgeCardDistillReceipt.js", () => ({ lookupKnowledgeCardDistillReceiptModel: mocks.lookup }));
vi.mock("./credits", async original => ({
  ...await original<Record<string, unknown>>(), getCredits: mocks.credits, deductCreditsAmount: mocks.deduct,
}));
vi.mock("./services/proxyImageService.js", async original => ({
  ...await original<Record<string, unknown>>(), generatePlatformCompositeSheetImage: mocks.image,
}));
import { appRouter } from "./routers";
const caller = () => appRouter.createCaller({ user: { id: 7, role: "user" } } as never);
const base = {
  sceneId: "pricing-test", title: "水循环", scriptContext: "# 水循环\n\n蒸发后凝结成雨。",
  kind: "single_page_knowledge_card" as const, notePageIndex: 1, notePageTotal: 1,
  distillModel: "deepseek-v4.1-flash-1017", confirmedPageCredits: 30,
};
beforeEach(() => {
  vi.resetAllMocks(); mocks.lookup.mockResolvedValue(null); mocks.credits.mockResolvedValue({ totalAvailable: 0 });
});
describe("手册真实API报价与扣费前门禁", () => {
  it("新价报价保留两档，旧账本覆盖客户端选档", async () => {
    expect(await caller().mvAnalysis.quoteKnowledgeCard({ markdown: base.scriptContext, distillModel: base.distillModel }))
      .toMatchObject({ pageCount: 1, credits: 30, billingModel: base.distillModel });
    expect(await caller().mvAnalysis.quoteKnowledgeCard({ markdown: base.scriptContext, distillModel: "glm-5.3-flashx" }))
      .toMatchObject({ credits: 34 });
    mocks.lookup.mockResolvedValue("glm-5.3-flash");
    expect(await caller().mvAnalysis.quoteKnowledgeCard({ markdown: base.scriptContext, distillModel: "glm-5.3-flashx" }))
      .toMatchObject({ credits: 24, billingModel: "glm-5.3-flash", hasReceipt: true });
  });
  it("未确认真实页价时零扣费、零模型调用", async () => {
    await expect(caller().mvAnalysis.generatePlatformCompositeSheet({ ...base, confirmedPageCredits: 24 }))
      .rejects.toThrow("本页报价已变化或尚未确认");
    expect(mocks.credits).not.toHaveBeenCalled(); expect(mocks.deduct).not.toHaveBeenCalled(); expect(mocks.image).not.toHaveBeenCalled();
  });
  it("单页稿伪造第九页折扣时在扣费前拒绝", async () => {
    await expect(caller().mvAnalysis.generatePlatformCompositeSheet({ ...base, notePageIndex: 9, notePageTotal: 9, confirmedPageCredits: 24 }))
      .rejects.toThrow("出图页码与当前稿件不一致");
    expect(mocks.credits).not.toHaveBeenCalled(); expect(mocks.deduct).not.toHaveBeenCalled(); expect(mocks.image).not.toHaveBeenCalled();
  });
  it("实际生成采用旧账本24积分，不接受客户端新价34", async () => {
    mocks.lookup.mockResolvedValue("glm-5.3-flash");
    await expect(caller().mvAnalysis.generatePlatformCompositeSheet({ ...base, distillModel: "glm-5.3-flashx", confirmedPageCredits: 34 }))
      .rejects.toThrow("本页报价已变化或尚未确认");
    await expect(caller().mvAnalysis.generatePlatformCompositeSheet({ ...base, distillModel: "glm-5.3-flashx", confirmedPageCredits: 24 }))
      .rejects.toThrow("需要 24 点");
    expect(mocks.deduct).not.toHaveBeenCalled(); expect(mocks.image).not.toHaveBeenCalled();
  });
});
