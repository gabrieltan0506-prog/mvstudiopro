import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ objects: new Map<string, any>(), jobs: new Map<string, any>(), balance: vi.fn(), deduct: vi.fn(), refund: vi.fn(), directRefund: vi.fn(), register: vi.fn(), settle: vi.fn(), pending: vi.fn(), generate: vi.fn(), save: vi.fn(), succeed: vi.fn(), recover: vi.fn() }));
vi.mock("./services/knowledgeCardReadingEdition.js", () => ({ loadKnowledgeCardReadingEdition: async () => ({
  editionId: "a".repeat(64), model: "gpt-5.6-sol", pages: Array.from({ length: 4 }, (_, i) => ({ pageId: `p${i + 1}`, ordinal: i + 1, title: "冻结标题", contentMarkdown: "冻结正文及原书知识", visualDirections: "沿用原书图文关系", sourcePageIds: ["s1", "s2", "s3"], referencePageIds: ["s3"], imageGsUris: ["gs://test-bucket/source3.png"] })),
}) }));
vi.mock("./services/knowledgeCardReadingStore.js", async original => ({ ...await original<typeof import("./services/knowledgeCardReadingStore")>(),
  readKnowledgeReadingJson: async (name: string) => m.objects.get(name) ?? null,
  saveKnowledgeReadingObject: m.save,
  claimKnowledgeReadingCall: async (name: string) => { if (m.objects.has(name)) return false; m.objects.set(name, { started: true }); return true; },
}));
vi.mock("./services/gcs.js", async original => ({ ...await original<typeof import("./services/gcs")>(), signGsUriV4ReadUrl: () => "https://example.invalid/source3.png" }));
vi.mock("./credits.js", async original => ({ ...await original<typeof import("./credits")>(), getCredits: m.balance, deductCreditsAmount: m.deduct, refundCreditsForDeductAmount: m.directRefund }));
vi.mock("./services/paidJobLedger.js", async original => ({ ...await original<typeof import("./services/paidJobLedger")>(), registerActiveJob: m.register, unregisterActiveJob: m.settle, refundCreditsOnFailure: m.refund, markSettlementPending: m.pending, heartbeatActiveJob: vi.fn() }));
vi.mock("./jobs/repository.js", async original => ({ ...await original<typeof import("./jobs/repository")>(),
  getJobByIdStrict: async (id: string) => m.jobs.get(id) ?? null,
  insertRunningCompositeSheetProgressJob: async (job: any) => { m.jobs.set(job.id, { ...job, status: "running" }); },
  markJobSucceeded: m.succeed, markJobSucceededWithRetry: m.recover,
  markJobFailed: async (id: string, error: string) => { Object.assign(m.jobs.get(id), { status: "failed", error }); },
}));
vi.mock("./services/proxyImageService.js", async original => ({ ...await original<typeof import("./services/proxyImageService")>(), generatePlatformCompositeSheetImage: m.generate, appendImageFlowLog: (log: string[], text: string) => log.push(text) }));
vi.mock("./services/tier-provider-routing", async original => ({ ...await original<typeof import("./services/tier-provider-routing")>(), resolveWatermark: async () => false }));
vi.mock("./jobs/compositeSheetLiveProgress.js", () => ({ attachCompositeSheetFlowLogLiveSync: () => () => {} }));
import { appRouter } from "./routers";
import { getKnowledgeCardReadingRenderStatus } from "./services/knowledgeCardReadingRender";
const reference = (attempt = 0) => ({ editionId: "a".repeat(64), pageId: "p1", attempt });
const request = (attempt = 0) => ({ sceneId: "伪造场景", title: "伪造标题", scriptContext: "伪造正文", kind: "single_page_knowledge_card" as const, readingPage: reference(attempt), notePageIndex: 9, notePageTotal: 80, distillModel: "qwen3.8-max" as const });
const call = (attempt = 0) => appRouter.createCaller({ user: { id: 7, role: "user" } } as never).mvAnalysis.generatePlatformCompositeSheet(request(attempt));
beforeEach(() => {
  vi.clearAllMocks(); m.objects.clear(); m.jobs.clear();
  m.balance.mockResolvedValue({ totalAvailable: 1000 });
  m.deduct.mockResolvedValue({ cost: 30, source: "personal" });
  m.refund.mockResolvedValue({ refunded: true, status: "refunded" });
  m.register.mockResolvedValue(undefined); m.settle.mockResolvedValue({ ok: true }); m.pending.mockResolvedValue(true);
  m.save.mockImplementation(async (name: string, data: Buffer) => { m.objects.set(name, JSON.parse(data.toString())); });
  m.succeed.mockImplementation(async (id: string, output: any) => { Object.assign(m.jobs.get(id), { status: "succeeded", output }); return true; });
  m.recover.mockImplementation(async (id: string, output: any) => { Object.assign(m.jobs.get(id), { status: "succeeded", output }); return true; });
  m.generate.mockResolvedValue("https://example.invalid/result.png");
});

describe("实际生成路由冻结知识卡扣费与恢复", () => {
  it("同页并发仅扣费及生产一次，冻结正文、模型价格和页序覆盖客户端；恢复只读原图", async () => {
    let release!: (url: string) => void;
    m.generate.mockImplementation(() => new Promise<string>(resolve => { release = resolve; }));
    const results = await Promise.all([call(), call()]);
    await vi.waitFor(() => expect(m.generate).toHaveBeenCalledTimes(1));
    if (!("progressJobId" in results[0]) || !("progressJobId" in results[1])) throw new Error("冻结页面未返回异步任务身份");
    expect(results[0].progressJobId).toBe(results[1].progressJobId);
    expect(m.deduct).toHaveBeenCalledTimes(1);
    expect(m.deduct).toHaveBeenCalledWith(7, 30, "platformCompositeSheet", expect.stringContaining("第1页"), { chargeKey: expect.stringMatching(/^platformCompositeSheet\/7\/[a-f0-9]{64}$/) });
    expect(m.generate).toHaveBeenCalledWith(expect.objectContaining({ title: "冻结标题", scriptContext: "冻结正文及原书知识", notePageIndex: 1, notePageTotal: 4, knowledgeCardFrozenPage: expect.objectContaining({ sourcePageIds: ["s1", "s2", "s3"], referenceImageUrls: ["https://example.invalid/source3.png"] }) }));
    release("https://example.invalid/result.png");
    await vi.waitFor(() => expect(m.settle).toHaveBeenCalledTimes(1));
    expect(await call()).toMatchObject({ imageUrl: "https://example.invalid/result.png", totalCost: 0, isAsync: false });
    expect(m.generate).toHaveBeenCalledTimes(1); expect(m.deduct).toHaveBeenCalledTimes(1); expect(m.refund).not.toHaveBeenCalled();
  });
  it("claim后余额不足保留可重试失败，未扣费；明确attempt1才新生成", async () => {
    m.balance.mockResolvedValueOnce({ totalAvailable: 1000 }).mockResolvedValueOnce({ totalAvailable: 0 });
    await expect(call()).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    expect((await getKnowledgeCardReadingRenderStatus(7, reference())).status).toBe("failed");
    expect(m.deduct).not.toHaveBeenCalled();
    await expect(call()).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await call(1); await vi.waitFor(() => expect(m.settle).toHaveBeenCalledTimes(1));
    expect(m.deduct).toHaveBeenCalledTimes(1);
  });
  it("扣费返回异常无法断言未扣款，保留reconcile且禁止新attempt", async () => {
    m.deduct.mockRejectedValueOnce(new Error("提交扣费后连接丢失"));
    await expect(call()).rejects.toThrow("连接丢失");
    expect((await getKnowledgeCardReadingRenderStatus(7, reference())).status).toBe("reconcile");
    await call(); await expect(call(1)).rejects.toThrow("尚未确认失败");
    expect(m.deduct).toHaveBeenCalledTimes(1); expect(m.generate).not.toHaveBeenCalled();
  });
  it.each([true, false])("无产物时退款确认=%s决定failed或reconcile，不能误报可重试", async refunded => {
    m.generate.mockRejectedValueOnce(new Error("模型没有产物"));
    m.refund.mockResolvedValue({ refunded, status: refunded ? "refunded" : "refund_pending" });
    await call();
    await vi.waitFor(async () => expect((await getKnowledgeCardReadingRenderStatus(7, reference())).status).toBe(refunded ? "failed" : "reconcile"));
    expect(m.refund).toHaveBeenCalledTimes(1); expect(m.settle).not.toHaveBeenCalled();
    if (refunded) { await call(1); await vi.waitFor(() => expect(m.settle).toHaveBeenCalledTimes(1)); }
    else await expect(call(1)).rejects.toThrow("尚未确认失败");
  });
  it("真实图片已生成但首次结果保存失败，只补存与待结算，不退款或再生成", async () => {
    m.save.mockRejectedValueOnce(new Error("对象存储暂不可用"));
    await call(); await vi.waitFor(() => expect(m.pending).toHaveBeenCalledTimes(1));
    expect(m.recover).toHaveBeenCalledTimes(1); expect(m.refund).not.toHaveBeenCalled();
    expect(await call()).toMatchObject({ imageUrl: "https://example.invalid/result.png", totalCost: 0 });
    expect(m.generate).toHaveBeenCalledTimes(1); expect(m.deduct).toHaveBeenCalledTimes(1);
  });
});
