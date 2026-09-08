import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ jobs: new Map<string, any>(), create: vi.fn(), get: vi.fn(), stat: vi.fn(), load: vi.fn(), loadEdition: vi.fn() }));
vi.mock("../jobs/repository.js", () => ({ createJob: mocks.create, getJobByIdStrict: mocks.get }));
vi.mock("../services/gcs.js", () => ({ getGcsBucketName: () => "test-bucket", statGcsObjectVersion: mocks.stat }));
vi.mock("../services/knowledgeCardReadingEdition.js", () => ({ loadKnowledgeCardReadingPlan: mocks.load, loadKnowledgeCardReadingEdition: mocks.loadEdition }));
vi.mock("../services/knowledgeCardReadingStore.js", async importOriginal => ({
  ...await importOriginal<typeof import("../services/knowledgeCardReadingStore")>(), readKnowledgeReadingJson: async () => null,
}));
import { router } from "../_core/trpc";
import { loadKnowledgeCardReadingPlan } from "../services/knowledgeCardReadingEdition.js";
import { knowledgeCardReadingProcedures } from "./knowledgeCardReading";
import { quoteKnowledgeCardReadingPlan, type KnowledgeCardReadingPlan } from "../../shared/knowledgeCardReadingPlan";
const api = router(knowledgeCardReadingProcedures);
const caller = (id = 7) => api.createCaller({ user: { id, role: "user" } } as never);
const planId = `${"a".repeat(64)}-${"b".repeat(64)}`;
const input = () => ({ model: "gpt-5.6-sol" as const, files: [{ gcsUri: "gs://test-bucket/uploads/u7/book.pdf", mimeType: "application/pdf", fileName: "原书.pdf" }] });
function loaded(budgetCredits?: number) {
  const plan: KnowledgeCardReadingPlan = { version: 1, sourceDigest: "c".repeat(64), model: "gpt-5.6-sol", presentation: "single", reason: "四页完整讲清", options: [{
    mode: "complete", reason: "保留全部知识", kept: ["知识与条件"], omitted: [], sourceExclusions: [], pages: Array.from({ length: 4 }, (_, index) => ({
      pageId: `p${index + 1}`, title: "知识", brief: "重要机制", sourcePageIds: ["source1"], visualDirections: "原稿图文对照",
    })),
  }] };
  const constraints = budgetCredits === undefined ? {} : { budgetCredits };
  return { analysis: { pages: Array.from({ length: 275 }, (_, index) => ({ id: index })) }, plan, constraints, quote: quoteKnowledgeCardReadingPlan(plan, constraints) };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.jobs.clear();
  expect(loadKnowledgeCardReadingPlan).toBe(mocks.load);
  mocks.stat.mockResolvedValue({ generation: "12345" });
  mocks.get.mockImplementation(async (id: string) => mocks.jobs.get(id) || null);
  mocks.create.mockImplementation(async (job: any) => {
    if (mocks.jobs.has(job.id)) throw new Error("duplicate primary key");
    mocks.jobs.set(job.id, { ...job, status: "queued" }); return job.id;
  });
  mocks.load.mockImplementation(async (id: number) => { if (id !== 7) throw new Error("方案不属于当前账号"); return loaded(); });
  mocks.loadEdition.mockImplementation(async (_userId: number, editionId: string) => ({ editionId, model: "gpt-5.6-sol", pages: [{ pageId: "p1", ordinal: 1 }] }));
});

describe("知识卡精读路由实际procedure", () => {
  it("同上传版本及约束始终返回同一个job，不重复入队，队列只存可信userId", async () => {
    const first = await caller().prepareKnowledgeCardReading(input());
    const second = await caller().prepareKnowledgeCardReading(input());
    expect(first).toEqual(second);
    expect(first.progressJobId).toMatch(/^kcr_[a-f0-9]{48}$/);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const job = mocks.create.mock.calls[0]![0];
    expect(job).toMatchObject({ userId: "7", type: "platform", input: { action: "knowledge_card_reading", params: { model: "gpt-5.6-sol", files: [{ generation: "12345" }], constraints: {} } } });
    expect(job.input.params).not.toHaveProperty("userId");
  });
  it("并发相同请求在数据库唯一冲突后读取胜出任务，只留一个队列记录", async () => {
    const results = await Promise.all([caller().prepareKnowledgeCardReading(input()), caller().prepareKnowledgeCardReading(input())]);
    expect(results[0]).toEqual(results[1]);
    expect(mocks.jobs.size).toBe(1);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
  it("文件版本、模型或预算改变才有新任务身份", async () => {
    const first = await caller().prepareKnowledgeCardReading(input());
    const budget = await caller().prepareKnowledgeCardReading({ ...input(), constraints: { budgetCredits: 120 } });
    const model = await caller().prepareKnowledgeCardReading({ ...input(), model: "qwen3.8-max" });
    mocks.stat.mockResolvedValue({ generation: "54321" });
    const file = await caller().prepareKnowledgeCardReading(input());
    expect(new Set([first, budget, model, file].map(item => item.progressJobId)).size).toBe(4);
  });
  it("真实source resolver拒绝其他账号原件及路径穿越，不到GCS版本查询和入队", async () => {
    await expect(caller(8).prepareKnowledgeCardReading(input())).rejects.toThrow("当前账号");
    await expect(caller().prepareKnowledgeCardReading({ ...input(), files: [{ ...input().files[0]!, gcsUri: "gs://test-bucket/uploads/u7/../u8/book.pdf" }] })).rejects.toThrow("当前账号");
    expect(mocks.stat).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("同ID既有记录归属不符时拒绝复用，数据库异常不伪造queued", async () => {
    mocks.get.mockResolvedValueOnce({ userId: "8", status: "succeeded" });
    await expect(caller().prepareKnowledgeCardReading(input())).rejects.toThrow("当前账号");
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.get.mockResolvedValue(null); mocks.create.mockRejectedValue(new Error("database offline"));
    await expect(caller().prepareKnowledgeCardReading(input())).rejects.toThrow("database offline");
  });
  it("failed和succeeded旧任务都返回原job状态，不重新下单", async () => {
    const first = await caller().prepareKnowledgeCardReading(input());
    for (const status of ["failed", "succeeded"]) {
      mocks.jobs.get(first.progressJobId).status = status;
      expect(await caller().prepareKnowledgeCardReading(input())).toEqual({ progressJobId: first.progressJobId, status });
    }
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("禁止低于四页、超过80页、退休模型或客户端夹带身份", async () => {
    for (const targetPages of [3, 81]) await expect(caller().prepareKnowledgeCardReading({ ...input(), constraints: { targetPages } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().prepareKnowledgeCardReading({ ...input(), model: "claude-opus-5" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().prepareKnowledgeCardReading({ ...input(), userId: 8 } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("完整只需四页时只能选择complete，预算不足四页不得入edition队列", async () => {
    await expect(caller().prepareKnowledgeCardReadingEdition({ planId, mode: "concise" })).rejects.toThrow("预算或目标页数");
    mocks.load.mockResolvedValue(loaded(119));
    await expect(caller().prepareKnowledgeCardReadingEdition({ planId, mode: "complete" })).rejects.toThrow("预算或目标页数");
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.load.mockResolvedValue(loaded(120));
    const first = await caller().prepareKnowledgeCardReadingEdition({ planId, mode: "complete" });
    const second = await caller().prepareKnowledgeCardReadingEdition({ planId, mode: "complete" });
    expect(first).toEqual(second);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]![0].input).toEqual({ action: "knowledge_card_edition", params: { planId, mode: "complete" } });
  });
  it("edition相同输入只建一个任务，计划读取按认证账号且返回实际275页计数", async () => {
    const results = [await caller().prepareKnowledgeCardReadingEdition({ planId, mode: "complete" }), await caller().prepareKnowledgeCardReadingEdition({ planId, mode: "complete" })];
    expect(results[0]).toEqual(results[1]); expect(mocks.jobs.size).toBe(1);
    const result = await caller().getKnowledgeCardReadingPlan({ planId });
    expect(result).toMatchObject({ planId, sourcePages: 275, quote: { defaultMode: "complete", minimumCredits: 120 } });
    expect(mocks.load).toHaveBeenCalledWith(7, planId);
    await expect(caller(8).getKnowledgeCardReadingPlan({ planId })).rejects.toThrow("当前账号");
  });
  it("状态只查本人同页，不创建任务；匿名全部拒绝", async () => {
    const request = { editionId: "d".repeat(64), pageId: "p1", subjectPosition: "center" as const };
    expect(await caller().getKnowledgeCardReadingPageStatus(request)).toMatchObject({ status: "not_started" });
    expect(mocks.loadEdition).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    const anon = api.createCaller({ user: null } as never);
    await expect(anon.prepareKnowledgeCardReading(input())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anon.getKnowledgeCardReadingPageStatus(request)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
