import { beforeEach, describe, expect, it, vi } from "vitest";
// 1119 C1：手册配图授权在 zod 层（早于占位预留与扣费）拦截；服务端自行绑定授权档，Skill/偏好改不了通道。
const mocks = vi.hoisted(() => ({ reserve: vi.fn(), credits: vi.fn(), deduct: vi.fn(), image: vi.fn(), succeeded: vi.fn(), failed: vi.fn() }));
vi.mock("./services/knowledgeCardDistillReceipt.js", () => ({ lookupKnowledgeCardDistillReceiptModel: async () => null }));
vi.mock("./jobs/knowledgeCardPageTask", async original => ({ ...await original<any>(), reserveKnowledgeCardImageJob: mocks.reserve, checkKnowledgeCardImageMaySubmit: async () => {} }));
vi.mock("./credits", async original => ({ ...await original<any>(), getCredits: mocks.credits, deductCreditsAmount: mocks.deduct }));
vi.mock("./services/knowledgeImageFailure", () => ({ markKnowledgeImageFailed: mocks.failed }));
vi.mock("./jobs/repository", async original => ({ ...await original<any>(), markJobSucceeded: mocks.succeeded }));
vi.mock("./services/proxyImageService.js", async original => ({ ...await original<any>(), generatePlatformCompositeSheetImage: mocks.image, appendImageFlowLog: (log: string[], value: string) => log.push(value) }));
vi.mock("./services/knowledgeCardDocumentPages.js", async original => ({ ...await original<any>(), resolveKnowledgeCardReferencePageUrls: async () => [] }));
vi.mock("./jobs/compositeSheetLiveProgress.js", () => ({ attachCompositeSheetFlowLogLiveSync: () => () => {} }));
vi.mock("./services/tier-provider-routing", async original => ({ ...await original<any>(), resolveWatermark: async () => false }));
vi.mock("./services/paidJobLedger.js", async original => ({ ...await original<any>(), registerActiveJob: async () => {}, refundCreditsOnFailure: async () => ({ refunded: true }), unregisterActiveJob: async () => {}, markSettlementPending: async () => true }));
import { appRouter } from "./routers";
const base = { sceneId: "auth-test", title: "水循环", scriptContext: "# 水循环\n\n蒸发后凝结成雨。", kind: "single_page_knowledge_card" as const, notePageIndex: 1, notePageTotal: 1, distillModel: "deepseek-v4.1-flash-1017", confirmedPageCredits: 30, pageRequestId: "12345678-1234-4123-8123-123456789abc" };
const caller = () => appRouter.createCaller({ user: { id: 7, role: "user" } } as never);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.reserve.mockResolvedValue({ id: "kc_image_job", claimed: true });
  mocks.credits.mockResolvedValue({ totalAvailable: 1000 });
  mocks.deduct.mockResolvedValue({ cost: 30, source: "personal" });
  mocks.image.mockResolvedValue("https://test.invalid/ok.png");
});
describe("手册配图授权（服务端绑定）", () => {
  it("Flare 档位：零占位、零扣费、零出图", async () => {
    await expect(caller().mvAnalysis.generatePlatformCompositeSheet({ ...base, openaiImageVariant: "flare" })).rejects.toThrow("未获授权");
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.credits).not.toHaveBeenCalled();
    expect(mocks.deduct).not.toHaveBeenCalled();
    expect(mocks.image).not.toHaveBeenCalled();
  });
  it.each([undefined, "sunburst"] as const)("档位 %s（含旧客户端缺字段）由服务端绑定 Sunburst", async variant => {
    await caller().mvAnalysis.generatePlatformCompositeSheet({ ...base, ...(variant ? { openaiImageVariant: variant } : {}) });
    await vi.waitFor(() => expect(mocks.image).toHaveBeenCalledTimes(1));
    expect(mocks.image.mock.calls[0][0]).toMatchObject({ openaiImageVariant: "sunburst", viralCreation: false, kind: "single_page_knowledge_card" });
    expect(mocks.deduct).toHaveBeenCalledTimes(1);
  });
  it("无关 Skill（xhs-content-growth）不能把手册改走爆款图片通道", async () => {
    await caller().mvAnalysis.generatePlatformCompositeSheet({ ...base, openaiImageVariant: "sunburst", enabledSkillIds: ["xhs-content-growth"] });
    await vi.waitFor(() => expect(mocks.image).toHaveBeenCalledTimes(1));
    expect(mocks.image.mock.calls[0][0]).toMatchObject({ viralCreation: false, openaiImageVariant: "sunburst" });
  });
  it("非手册（2×4 分镜）仍按原档位透传，不受手册门禁影响", async () => {
    await caller().mvAnalysis.generatePlatformCompositeSheet({ sceneId: "s", title: "t", scriptContext: "分镜正文", kind: "storyboard_sheet_landscape", openaiImageVariant: "flare" }).catch(() => {});
    expect(mocks.image.mock.calls[0]?.[0]?.openaiImageVariant).toBe("flare");
  });
});
