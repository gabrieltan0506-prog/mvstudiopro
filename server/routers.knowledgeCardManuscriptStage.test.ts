import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
// 1119 C4：大稿分段暂存 → 摘要报价 → 摘要逐页出图；全部走真实 routers 与真实暂存模块，只桩对象存储、账本与出图供应商边界。
const mocks = vi.hoisted(() => ({
  objects: new Map<string, string>(), readFail: { on: false },
  reserve: vi.fn(), credits: vi.fn(), deduct: vi.fn(), image: vi.fn(), lookup: vi.fn(), succeeded: vi.fn(), failed: vi.fn(),
}));
vi.mock("./services/gcs", async original => ({
  ...await original<any>(),
  getGcsBucketName: () => "test-bucket",
  uploadBufferToGcs: vi.fn(async (p: { objectName: string; buffer: Buffer; ifGenerationMatch?: string }) => {
    if (p.ifGenerationMatch === "0" && mocks.objects.has(p.objectName)) throw new Error("gcs_upload_failed:412 precondition");
    mocks.objects.set(p.objectName, p.buffer.toString("utf8"));
    return { bucket: "test-bucket", objectName: p.objectName, gcsUri: `gs://test-bucket/${p.objectName}` };
  }),
  downloadGcsObjectVersioned: vi.fn(async (p: { gcsUri: string }) => {
    if (mocks.readFail.on) throw new Error("gcs_download_failed:503");
    const name = p.gcsUri.replace("gs://test-bucket/", "");
    if (!mocks.objects.has(name)) throw new Error("gcs_stat_failed:404");
    return { buffer: Buffer.from(mocks.objects.get(name)!, "utf8"), bucket: "test-bucket", objectName: name, generation: "1" };
  }),
}));
vi.mock("./services/knowledgeCardDistillReceipt.js", () => ({ lookupKnowledgeCardDistillReceiptModel: mocks.lookup }));
vi.mock("./services/knowledgeCardDistillReceipt", () => ({ lookupKnowledgeCardDistillReceiptModel: mocks.lookup }));
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
import { planKnowledgeCardPages, KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS } from "../shared/knowledgeCardPagination";
import { __clearHandbookManuscriptCacheForTest } from "./services/handbookManuscriptStage";
import { recoveryDraft, hydrateStagedManuscriptRows } from "./services/knowledgeCardRecovery";
import { validateKnowledgeImageReplacements } from "./services/knowledgePublicationImages";
import { knowledgeCardPageJobId } from "./jobs/knowledgeCardPageTask";
import { loadHandbookManuscript } from "./services/handbookManuscriptStage";

const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const caller = (id = 7) => appRouter.createCaller({ user: { id, role: "user" } } as never);
const MODEL = "deepseek-v4.1-flash-1017";
function book(chars: number) {
  const parts: string[] = ["# 大书"]; let i = 0;
  while (parts.join("\n\n").length < chars) parts.push(`## 第${++i}节\n${`知识点${i}：光合作用把光能转化为化学能。`.repeat(40)}`);
  return parts.join("\n\n").slice(0, chars);
}
async function stage(text: string, user = 7, skip: number[] = []) {
  const digest = sha(text), count = Math.ceil(text.length / KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS);
  for (let index = 0; index < count; index++) if (!skip.includes(index))
    await caller(user).mvAnalysis.stageKnowledgeCardManuscriptChunk({ digest, index, count, totalChars: text.length, text: text.slice(index * KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS, (index + 1) * KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS) });
  return { digest, count };
}
const pageInput = (extra: Record<string, unknown>) => ({ sceneId: "big", title: "大书", kind: "single_page_knowledge_card" as const, distillModel: MODEL, confirmedPageCredits: 30, notePageIndex: 1, pageRequestId: "12345678-1234-4123-8123-123456789abc", openaiImageVariant: "sunburst" as const, ...extra });
const BIG = book(2_000_000);
const BIG_PLAN = planKnowledgeCardPages(BIG);

beforeEach(() => {
  vi.clearAllMocks(); mocks.objects.clear(); mocks.readFail.on = false; __clearHandbookManuscriptCacheForTest();
  mocks.reserve.mockResolvedValue({ id: "kc_page_job", claimed: true });
  mocks.credits.mockResolvedValue({ totalAvailable: 100_000 });
  mocks.deduct.mockResolvedValue({ cost: 30, source: "personal" });
  mocks.image.mockResolvedValue("https://test.invalid/ok.png");
  mocks.lookup.mockResolvedValue(null);
});

describe("暂存：内容寻址、幂等、缺段与摘要校验", () => {
  it("重复上传同一原稿幂等；同段不同内容拒绝覆盖", async () => {
    const { digest, count } = await stage(BIG);
    const before = new Map(mocks.objects);
    await stage(BIG);
    expect(mocks.objects).toEqual(before);
    await expect(caller().mvAnalysis.stageKnowledgeCardManuscriptChunk({ digest, index: 0, count, totalChars: BIG.length, text: "改".repeat(KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS) })).rejects.toThrow("内容不同");
    expect(mocks.objects.get(`knowledge-card-manuscript/user-7/${digest}/chunk-0.json`)).toBe(before.get(`knowledge-card-manuscript/user-7/${digest}/chunk-0.json`));
  });
  it("摘要不一致：封存拒绝，不写清单", async () => {
    const wrong = "f".repeat(64), count = Math.ceil(BIG.length / KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS);
    for (let index = 0; index < count; index++) await caller().mvAnalysis.stageKnowledgeCardManuscriptChunk({ digest: wrong, index, count, totalChars: BIG.length, text: BIG.slice(index * 200_000, (index + 1) * 200_000) });
    await expect(caller().mvAnalysis.finalizeKnowledgeCardManuscript({ digest: wrong, count, totalChars: BIG.length })).rejects.toThrow("不一致");
    expect([...mocks.objects.keys()].some(k => k.endsWith("manifest.json"))).toBe(false);
  });
  it("缺段（客户端中途死掉）：不能封存、不能报价、不能出图；补传后可继续", async () => {
    const { digest, count } = await stage(BIG, 7, [3]);
    await expect(caller().mvAnalysis.finalizeKnowledgeCardManuscript({ digest, count, totalChars: BIG.length })).rejects.toThrow("缺第 4 段");
    await expect(caller().mvAnalysis.quoteKnowledgeCardForGeneration({ manuscriptDigest: digest, distillModel: MODEL })).rejects.toThrow("尚未完整上传");
    await expect(caller().mvAnalysis.generatePlatformCompositeSheet(pageInput({ manuscriptDigest: digest, pageBody: BIG_PLAN.pages[0], notePageTotal: BIG_PLAN.pageCount }))).rejects.toThrow("尚未完整上传");
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.deduct).not.toHaveBeenCalled();
    await stage(BIG);
    await caller().mvAnalysis.finalizeKnowledgeCardManuscript({ digest, count, totalChars: BIG.length });
    expect((await caller().mvAnalysis.quoteKnowledgeCardForGeneration({ manuscriptDigest: digest, distillModel: MODEL })).pageCount).toBe(BIG_PLAN.pageCount);
  });
});

describe("出图：摘要路径在占位与扣费之前校验", () => {
  async function sealed(text = BIG, user = 7) {
    const { digest, count } = await stage(text, user);
    await caller(user).mvAnalysis.finalizeKnowledgeCardManuscript({ digest, count, totalChars: text.length });
    return digest;
  }
  it("200 万字原稿：分段暂存、报价、到达出图调用；回执查询与计价拿到的是全文；任务行只存摘要", async () => {
    const digest = await sealed();
    const quote = await caller().mvAnalysis.quoteKnowledgeCardForGeneration({ manuscriptDigest: digest, distillModel: MODEL });
    expect(quote.pageCount).toBe(BIG_PLAN.pageCount);
    expect(mocks.lookup).toHaveBeenLastCalledWith(7, BIG);
    await caller().mvAnalysis.generatePlatformCompositeSheet(pageInput({ manuscriptDigest: digest, pageBody: BIG_PLAN.pages[0], notePageTotal: BIG_PLAN.pageCount }));
    await vi.waitFor(() => expect(mocks.image).toHaveBeenCalledTimes(1));
    expect(mocks.image.mock.calls[0][0].scriptContext).toBe(BIG);
    expect(mocks.lookup).toHaveBeenLastCalledWith(7, BIG);
    const params = mocks.reserve.mock.calls[0][0].params;
    expect(params.manuscriptDigest).toBe(digest);
    expect(params).not.toHaveProperty("scriptContext");
    expect(mocks.deduct.mock.calls[0][4].chargeKey).toMatch(/^platformCompositeSheet\/7\/[a-z0-9_]+$/);
  });
  it("篡改本页正文：零占位、零扣费、零出图", async () => {
    const digest = await sealed();
    await expect(caller().mvAnalysis.generatePlatformCompositeSheet(pageInput({ manuscriptDigest: digest, pageBody: BIG_PLAN.pages[0] + "（篡改）", notePageTotal: BIG_PLAN.pageCount }))).rejects.toThrow("不一致");
    await expect(caller().mvAnalysis.generatePlatformCompositeSheet(pageInput({ manuscriptDigest: digest, pageBody: BIG_PLAN.pages[1], notePageTotal: BIG_PLAN.pageCount }))).rejects.toThrow("不一致");
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.credits).not.toHaveBeenCalled(); expect(mocks.deduct).not.toHaveBeenCalled(); expect(mocks.image).not.toHaveBeenCalled();
  });
  it("出图时存储读取失败：零占位、零扣费，明确报错", async () => {
    const digest = await sealed();
    mocks.readFail.on = true;
    await expect(caller().mvAnalysis.generatePlatformCompositeSheet(pageInput({ manuscriptDigest: digest, pageBody: BIG_PLAN.pages[0], notePageTotal: BIG_PLAN.pageCount }))).rejects.toThrow("暂时读不到");
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.deduct).not.toHaveBeenCalled();
  });
  it("跨账号摘要：用户 7 用不了用户 8 暂存的原稿", async () => {
    const digest = await sealed(BIG, 8);
    await expect(caller(7).mvAnalysis.quoteKnowledgeCardForGeneration({ manuscriptDigest: digest, distillModel: MODEL })).rejects.toThrow("尚未完整上传");
    await expect(caller(7).mvAnalysis.generatePlatformCompositeSheet(pageInput({ manuscriptDigest: digest, pageBody: BIG_PLAN.pages[0], notePageTotal: BIG_PLAN.pageCount }))).rejects.toThrow("尚未完整上传");
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.deduct).not.toHaveBeenCalled();
  });
  it("15 万字原稿：请求、任务行 params、回执查询与报价与旧版完全一致，不触碰暂存", async () => {
    const text = book(150_000), plan = planKnowledgeCardPages(text);
    const quote = await caller().mvAnalysis.quoteKnowledgeCardForGeneration({ markdown: text, distillModel: MODEL });
    expect(quote.pageCount).toBe(plan.pageCount);
    const input = { sceneId: "s", title: "t", scriptContext: text, kind: "single_page_knowledge_card" as const, distillModel: MODEL, confirmedPageCredits: 30, notePageIndex: 1, notePageTotal: plan.pageCount, pageRequestId: "12345678-1234-4123-8123-123456789abc", openaiImageVariant: "sunburst" as const };
    await caller().mvAnalysis.generatePlatformCompositeSheet(input);
    await vi.waitFor(() => expect(mocks.image).toHaveBeenCalledTimes(1));
    expect(mocks.reserve.mock.calls[0][0]).toEqual({ userId: "7", requestId: input.pageRequestId, params: { ...input } });
    expect(mocks.lookup).toHaveBeenLastCalledWith(7, text);
    expect(mocks.objects.size).toBe(0);
  });
  it("缺正文也缺摘要、或二者都带：zod 拒绝", async () => {
    await expect(caller().mvAnalysis.generatePlatformCompositeSheet(pageInput({ notePageTotal: 1 }))).rejects.toThrow("二选一");
    await expect(caller().mvAnalysis.generatePlatformCompositeSheet(pageInput({ notePageTotal: 1, scriptContext: "x", manuscriptDigest: "a".repeat(64), pageBody: "x" }))).rejects.toThrow("二选一");
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
});

describe("恢复与配图绑定：新旧两种任务行", () => {
  it("新行（只存摘要）取回全文后，恢复键与同稿旧行完全一致；配图绑定通过", async () => {
    const { digest, count } = await stage(BIG);
    await caller().mvAnalysis.finalizeKnowledgeCardManuscript({ digest, count, totalChars: BIG.length });
    const common = { kind: "single_page_knowledge_card", distillModel: MODEL, notePageIndex: 1, notePageTotal: BIG_PLAN.pageCount, subjectPosition: "left", openaiImageVariant: "sunburst" };
    const oldRow = { id: "old", userId: "7", status: "succeeded", createdAt: new Date(), input: { action: "platform_composite_sheet_progress", params: { ...common, scriptContext: BIG } }, output: { compositeImageUrl: "https://x/1.png" } };
    const newRow = { ...oldRow, id: "new", input: { action: "platform_composite_sheet_progress", params: { ...common, manuscriptDigest: digest, pageBody: BIG_PLAN.pages[0] } } };
    const [hydrated] = await hydrateStagedManuscriptRows([newRow]);
    expect(recoveryDraft(hydrated)!.key).toBe(recoveryDraft(oldRow)!.key);
    expect(recoveryDraft(hydrated)!.markdown).toBe(BIG);
    // 旧行原样返回（同一对象），不读暂存
    const [same] = await hydrateStagedManuscriptRows([oldRow], async () => { throw new Error("不应读取"); });
    expect(same).toBe(oldRow);
    // 取回失败的新行不参与恢复（不猜文本）
    expect(await hydrateStagedManuscriptRows([newRow], async () => { throw new Error("503"); })).toEqual([]);
    // 配图绑定：替换任务是新形态行
    const requestId = "22222222-2222-4222-8222-222222222222";
    const replacement = knowledgeCardPageJobId("7", "platform_composite_sheet_progress", requestId);
    const jobs: Record<string, any> = {
      original: { userId: "7", status: "failed", output: { knowledgeImageRetry: { version: 1, reason: "refunded" } }, input: { action: "platform_composite_sheet_progress", params: {} } },
      [replacement]: { userId: "7", status: "succeeded", input: { action: "platform_composite_sheet_progress", params: { ...common, manuscriptDigest: digest } } },
    };
    const next: any = { source: { pages: [{ imageJobId: "original", body: BIG_PLAN.pages[0] }] }, imageAttempts: { original: { requestId, jobId: replacement } }, imageReplacements: { original: replacement } };
    const before: any = { source: next.source, imageAttempts: { original: { requestId, jobId: replacement } } };
    await expect(validateKnowledgeImageReplacements(7, before, next, async (id: string) => jobs[id] ?? null, loadHandbookManuscript)).resolves.toBeUndefined();
    // 旧形态替换行照旧
    jobs[replacement].input.params = { ...common, scriptContext: BIG };
    await expect(validateKnowledgeImageReplacements(7, before, next, async (id: string) => jobs[id] ?? null, async () => { throw new Error("旧行不应读取暂存"); })).resolves.toBeUndefined();
    // 摘要对应的页正文与原稿页不符 → 拒绝
    next.source.pages[0].body = BIG_PLAN.pages[1];
    jobs[replacement].input.params = { ...common, manuscriptDigest: digest };
    await expect(validateKnowledgeImageReplacements(7, before, next, async (id: string) => jobs[id] ?? null, loadHandbookManuscript)).rejects.toThrow("不一致");
  });
});
