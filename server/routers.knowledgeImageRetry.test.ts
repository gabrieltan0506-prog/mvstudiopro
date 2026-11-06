import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ credits: vi.fn(), deduct: vi.fn(), image: vi.fn(), failed: vi.fn(), succeeded: vi.fn(), refund: vi.fn(), settle: vi.fn(), pending: vi.fn() }));
vi.mock("./services/knowledgeCardDistillReceipt.js", () => ({ lookupKnowledgeCardDistillReceiptModel: async () => null }));
vi.mock("./jobs/knowledgeCardPageTask", async original => ({ ...await original<any>(), reserveKnowledgeCardImageJob: async () => ({ id: "actual-image-job", claimed: true }), checkKnowledgeCardImageMaySubmit: async () => {} }));
vi.mock("./credits", async original => ({ ...await original<any>(), getCredits: mocks.credits, deductCreditsAmount: mocks.deduct }));
vi.mock("./services/knowledgeImageFailure", () => ({ markKnowledgeImageFailed: mocks.failed }));
vi.mock("./jobs/repository", async original => ({ ...await original<any>(), markJobSucceeded: mocks.succeeded }));
vi.mock("./services/proxyImageService.js", async original => ({ ...await original<any>(), generatePlatformCompositeSheetImage: mocks.image, appendImageFlowLog: (log: string[], value: string) => log.push(value) }));
vi.mock("./services/knowledgeCardDocumentPages.js", async original => ({ ...await original<any>(), resolveKnowledgeCardReferencePageUrls: async () => [] }));
vi.mock("./jobs/compositeSheetLiveProgress.js", () => ({ attachCompositeSheetFlowLogLiveSync: () => () => {} }));
vi.mock("./services/tier-provider-routing", async original => ({ ...await original<any>(), resolveWatermark: async () => false }));
vi.mock("./services/paidJobLedger.js", async original => ({ ...await original<any>(), registerActiveJob: async () => {}, refundCreditsOnFailure: mocks.refund, unregisterActiveJob: mocks.settle, markSettlementPending: mocks.pending }));
import { appRouter } from "./routers";
const base = { sceneId: "image-retry-test", title: "水循环", scriptContext: "# 水循环\n\n蒸发后凝结成雨。", kind: "single_page_knowledge_card" as const, notePageIndex: 1, notePageTotal: 1, distillModel: "deepseek-v4.1-flash-1017", confirmedPageCredits: 30, pageRequestId: "12345678-1234-4123-8123-123456789abc" };
const caller = (role = "user") => appRouter.createCaller({ user: { id: 7, role } } as never);
beforeEach(() => { vi.resetAllMocks(); mocks.credits.mockResolvedValue({ totalAvailable: 1000 }); mocks.deduct.mockResolvedValue({ cost: 30, source: "personal" }); mocks.refund.mockResolvedValue({ refunded: false, status: "refund_pending" }); mocks.settle.mockResolvedValue(undefined); mocks.pending.mockResolvedValue(true); });
describe("知识配图失败重购证据来自真实分支", () => {
  it("扣款调用回包失败保持pending，不因receipt未赋值而标未扣款", async () => {
    mocks.deduct.mockRejectedValue(new Error("deduction response lost"));
    await expect(caller().mvAnalysis.generatePlatformCompositeSheet(base)).rejects.toThrow("deduction response lost");
    expect(mocks.failed).toHaveBeenCalledWith("actual-image-job", "7", "deduction response lost", "pending");
    expect(mocks.image).not.toHaveBeenCalled();
  });
  it("管理员零扣款的上游unknown也不能标为可重购", async () => {
    mocks.image.mockRejectedValue(Object.assign(new Error("supplier uncertain"), { kind: "unknown" }));
    await caller("admin").mvAnalysis.generatePlatformCompositeSheet(base);
    await vi.waitFor(() => expect(mocks.failed).toHaveBeenCalled());
    expect(mocks.failed.mock.calls[0][3]).toBe("pending");
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("明确失败但退款仍pending不可重购，真实退款完成才允许", async () => {
    mocks.image.mockRejectedValue(new Error("explicit failed"));
    await caller().mvAnalysis.generatePlatformCompositeSheet(base);
    await vi.waitFor(() => expect(mocks.failed).toHaveBeenCalled());
    expect(mocks.failed.mock.calls[0][3]).toBe("pending");
    mocks.failed.mockClear(); mocks.refund.mockResolvedValue({ refunded: true, status: "refunded" });
    await caller().mvAnalysis.generatePlatformCompositeSheet(base);
    await vi.waitFor(() => expect(mocks.failed).toHaveBeenCalled());
    expect(mocks.failed.mock.calls[0][3]).toBe("refunded");
  });
});
