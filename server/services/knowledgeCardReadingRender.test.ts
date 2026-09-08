import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ objects: new Map<string, any>(), jobs: new Map<string, any>(), load: vi.fn(), claim: vi.fn(), save: vi.fn(), job: vi.fn(), sign: vi.fn() }));
vi.mock("./knowledgeCardReadingEdition.js", () => ({ loadKnowledgeCardReadingEdition: mocks.load }));
vi.mock("../jobs/repository.js", () => ({ getJobByIdStrict: mocks.job }));
vi.mock("./gcs.js", () => ({ signGsUriV4ReadUrl: mocks.sign, getGcsBucketName: () => "test-bucket" }));
vi.mock("./knowledgeCardReadingStore.js", async importOriginal => ({
  ...await importOriginal<typeof import("./knowledgeCardReadingStore")>(),
  readKnowledgeReadingJson: async (name: string) => mocks.objects.get(name) ?? null,
  saveKnowledgeReadingObject: mocks.save, claimKnowledgeReadingCall: mocks.claim,
}));
import {
  resolveKnowledgeCardReadingRender, getKnowledgeCardReadingRenderStatus, claimKnowledgeCardReadingRender,
  knowledgeCardFrozenPageForRender, saveKnowledgeCardReadingRenderResult, saveKnowledgeCardReadingRenderFailure,
} from "./knowledgeCardReadingRender";
import type { KnowledgeCardReadingEdition } from "./knowledgeCardReadingEdition";

const editionId = "a".repeat(64);
const input = () => ({ editionId, pageId: "p1" });
let edition: KnowledgeCardReadingEdition;
beforeEach(() => {
  vi.clearAllMocks(); mocks.objects.clear(); mocks.jobs.clear();
  edition = {
    editionId, planId: `${"b".repeat(64)}-${"c".repeat(64)}`, mode: "complete", model: "gpt-5.6-sol", credits: 288,
    pages: Array.from({ length: 10 }, (_, index) => ({ pageId: `p${index + 1}`, ordinal: index + 1, title: `标题${index + 1}`, contentMarkdown: "## 机制\n只来自已确认原稿的知识与数字。", visualDirections: "原书图文对照重绘，原图不锁脸", sourcePageIds: ["source1", "source2", "source3"], referencePageIds: ["source3"], imageGsUris: ["gs://test-bucket/reading/u7/source3.png"] })),
  };
  mocks.load.mockImplementation(async (userId: number, id: string) => {
    if (userId !== 7 || id !== editionId) throw new Error("版本不属于当前账号");
    return structuredClone(edition);
  });
  mocks.job.mockImplementation(async (id: string) => mocks.jobs.get(id) ?? null);
  mocks.claim.mockImplementation(async (name: string) => {
    if (mocks.objects.has(name)) return false;
    mocks.objects.set(name, { startedAt: "test" }); return true;
  });
  mocks.save.mockImplementation(async (name: string, buffer: Buffer) => {
    const value = JSON.parse(buffer.toString());
    if (mocks.objects.has(name) && JSON.stringify(mocks.objects.get(name)) !== JSON.stringify(value)) throw new Error("已存在记录不能覆盖");
    mocks.objects.set(name, value);
  });
  mocks.sign.mockImplementation((uri: string) => `https://example.invalid/signed/${encodeURIComponent(uri)}`);
});

describe("冻结知识卡页面的真实生成身份与恢复服务", () => {
  it.each([true, false])("失败回执safeToRetry=%s优先于运行job，只有已退款失败允许显式重试", async safeToRetry => {
    const resolved = await resolveKnowledgeCardReadingRender(7, input());
    mocks.jobs.set(resolved.progressJobId, { userId: "7", status: "running" });
    await saveKnowledgeCardReadingRenderFailure(resolved, new Error("已知诊断"), safeToRetry);
    expect((await getKnowledgeCardReadingRenderStatus(7, input())).status).toBe(safeToRetry ? "failed" : "reconcile");
    const retry = await resolveKnowledgeCardReadingRender(7, { ...input(), attempt: 1 });
    if (safeToRetry) expect(await claimKnowledgeCardReadingRender(7, retry)).toBe(true);
    else await expect(claimKnowledgeCardReadingRender(7, retry)).rejects.toThrow("尚未确认失败");
    await saveKnowledgeCardReadingRenderResult(resolved, "https://example.invalid/recovered.png");
    expect((await getKnowledgeCardReadingRenderStatus(7, input())).status).toBe("succeeded");
  });
  it("对账回执之后原jobs补存成功时恢复现有成品，不被旧reconcile永久挡住", async () => {
    const resolved = await resolveKnowledgeCardReadingRender(7, input());
    await saveKnowledgeCardReadingRenderFailure(resolved, new Error("成品待补存"), false);
    mocks.jobs.set(resolved.progressJobId, { userId: "7", status: "succeeded", output: { compositeImageUrl: "https://example.invalid/recovered.png" } });
    expect(await getKnowledgeCardReadingRenderStatus(7, input())).toMatchObject({ status: "succeeded", imageUrl: "https://example.invalid/recovered.png" });
    mocks.jobs.set(resolved.progressJobId, { userId: "8", status: "succeeded", output: { compositeImageUrl: "https://example.invalid/other.png" } });
    await expect(getKnowledgeCardReadingRenderStatus(7, input())).rejects.toThrow("归属");
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("已归属当前账号的完成回执读取时刷新本桶签名，不改永久结果或重开任务", async () => {
    const resolved = await resolveKnowledgeCardReadingRender(7, input());
    const oldUrl = "https://storage.googleapis.com/test-bucket/cards/result.png?X-Goog-Signature=expired-test";
    await saveKnowledgeCardReadingRenderResult(resolved, oldUrl);
    mocks.save.mockClear(); mocks.claim.mockClear();
    const status = await getKnowledgeCardReadingRenderStatus(7, input());
    expect(status.imageUrl).toBe("https://example.invalid/signed/gs%3A%2F%2Ftest-bucket%2Fcards%2Fresult.png");
    expect(mocks.sign).toHaveBeenCalledWith("gs://test-bucket/cards/result.png", 604800);
    expect(mocks.objects.get(`${resolved.prefix}/result.json`).imageUrl).toBe(oldUrl);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("同页+风格+位置+attempt得到固定身份，省略默认值等于显式默认值", async () => {
    const first = await resolveKnowledgeCardReadingRender(7, input());
    const same = await resolveKnowledgeCardReadingRender(7, { ...input(), attempt: 0, subjectPosition: "left", infographicTemplateId: "" });
    expect(same.renderId).toBe(first.renderId);
    expect(same.progressJobId).toBe(first.progressJobId);
    expect(first.prefix).toBe(`knowledge-card-reading/u7/renders/${first.renderId}`);
    expect(first.progressJobId).toMatch(/^kcp_[a-f0-9]{48}$/);
    const changed = await Promise.all([
      resolveKnowledgeCardReadingRender(7, { ...input(), pageId: "p2" }),
      resolveKnowledgeCardReadingRender(7, { ...input(), subjectPosition: "center" }),
      resolveKnowledgeCardReadingRender(7, { ...input(), infographicTemplateId: "infographic_material_lab" }),
      resolveKnowledgeCardReadingRender(7, { ...input(), attempt: 1 }),
    ]);
    expect(new Set([first, ...changed].map(item => item.renderId)).size).toBe(5);
  });
  it("页费严格读取冻结模型和序号，第9页折扣不受客户端声明影响", async () => {
    expect((await resolveKnowledgeCardReadingRender(7, input())).cost).toBe(30);
    expect((await resolveKnowledgeCardReadingRender(7, { ...input(), pageId: "p9" })).cost).toBe(24);
    edition.model = "qwen3.8-max";
    expect((await resolveKnowledgeCardReadingRender(7, { ...input(), pageId: "p9" })).cost).toBe(19);
    await expect(resolveKnowledgeCardReadingRender(7, { ...input(), model: "qwen3.8-max" } as never)).rejects.toThrow();
  });
  it("他人版本、不属于方案的页、非法attempt或位置在生成前拒绝", async () => {
    await expect(resolveKnowledgeCardReadingRender(8, input())).rejects.toThrow("当前账号");
    await expect(resolveKnowledgeCardReadingRender(7, { ...input(), pageId: "missing" })).rejects.toThrow("不属于");
    for (const attempt of [-1, 0.5, 101]) await expect(resolveKnowledgeCardReadingRender(7, { ...input(), attempt })).rejects.toThrow();
    await expect(resolveKnowledgeCardReadingRender(7, { ...input(), subjectPosition: "right" } as never)).rejects.toThrow();
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("单页并发占用只有一次成功，状态查询不占用、不保存、不新建任务", async () => {
    const resolved = await resolveKnowledgeCardReadingRender(7, input());
    const claims = await Promise.all([claimKnowledgeCardReadingRender(7, resolved), claimKnowledgeCardReadingRender(7, resolved)]);
    expect(claims.sort()).toEqual([false, true]);
    mocks.claim.mockClear(); mocks.save.mockClear();
    for (let i = 0; i < 3; i++) expect((await getKnowledgeCardReadingRenderStatus(7, input())).status).toBe("starting");
    expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.jobs.size).toBe(0);
  });
  it("没有claim或job时not_started；存在job只读取同owner原状态和结果", async () => {
    const resolved = await resolveKnowledgeCardReadingRender(7, input());
    expect((await getKnowledgeCardReadingRenderStatus(7, input())).status).toBe("not_started");
    for (const status of ["queued", "running", "succeeded"]) {
      mocks.jobs.set(resolved.progressJobId, { userId: "7", status, output: { compositeImageUrl: "https://example.invalid/original.png" }, error: "既有诊断" });
      expect(await getKnowledgeCardReadingRenderStatus(7, input())).toMatchObject({ progressJobId: resolved.progressJobId, status, imageUrl: "https://example.invalid/original.png", error: "既有诊断" });
    }
    mocks.jobs.set(resolved.progressJobId, { userId: "7", status: "failed", error: "stale timeout" });
    expect((await getKnowledgeCardReadingRenderStatus(7, input())).status).toBe("reconcile");
    const retry = await resolveKnowledgeCardReadingRender(7, { ...input(), attempt: 1 });
    await expect(claimKnowledgeCardReadingRender(7, retry)).rejects.toThrow("尚未确认失败");
    mocks.jobs.set(resolved.progressJobId, { userId: "8", status: "running" });
    await expect(getKnowledgeCardReadingRenderStatus(7, input())).rejects.toThrow("归属");
  });
  it("已有图片结果优先返回且不再次占用或收费，同次claim不能重新提交", async () => {
    const resolved = await resolveKnowledgeCardReadingRender(7, input());
    await claimKnowledgeCardReadingRender(7, resolved);
    await saveKnowledgeCardReadingRenderResult(resolved, "https://example.invalid/result.png");
    mocks.job.mockClear(); mocks.save.mockClear();
    expect(await getKnowledgeCardReadingRenderStatus(7, input())).toEqual({ progressJobId: resolved.progressJobId, status: "succeeded", imageUrl: "https://example.invalid/result.png" });
    expect(mocks.job).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
    expect(await claimKnowledgeCardReadingRender(7, resolved)).toBe(false);
  });
  it.each(["not_started", "starting", "queued", "running", "succeeded"])("上一次%s不能发起attempt1", async status => {
    const previous = await resolveKnowledgeCardReadingRender(7, input());
    if (status === "starting") mocks.objects.set(`${previous.prefix}/claim.json`, { started: true });
    else if (status !== "not_started") mocks.jobs.set(previous.progressJobId, { userId: "7", status, output: null });
    const next = await resolveKnowledgeCardReadingRender(7, { ...input(), attempt: 1 });
    await expect(claimKnowledgeCardReadingRender(7, next)).rejects.toThrow("尚未确认失败");
    expect(mocks.objects.has(`${next.prefix}/claim.json`)).toBe(false);
  });
  it("只有相同风格位置的紧邻前次failed才能重试，不能跳过attempt", async () => {
    const previous = await resolveKnowledgeCardReadingRender(7, input());
    mocks.jobs.set(previous.progressJobId, { userId: "7", status: "failed", output: null });
    await saveKnowledgeCardReadingRenderFailure(previous, new Error("业务确认失败且已退款"), true);
    const next = await resolveKnowledgeCardReadingRender(7, { ...input(), attempt: 1 });
    expect(await claimKnowledgeCardReadingRender(7, next)).toBe(true);
    const skipped = await resolveKnowledgeCardReadingRender(7, { ...input(), attempt: 2 });
    await expect(claimKnowledgeCardReadingRender(7, skipped)).rejects.toThrow("尚未确认失败");
    const differentPosition = await resolveKnowledgeCardReadingRender(7, { ...input(), attempt: 1, subjectPosition: "center" });
    await expect(claimKnowledgeCardReadingRender(7, differentPosition)).rejects.toThrow("尚未确认失败");
  });
  it("冻结正文与所有知识来源原样交给下游，原页图片单独作为签名参考而非替换来源", async () => {
    const resolved = await resolveKnowledgeCardReadingRender(7, input());
    const frozen = knowledgeCardFrozenPageForRender(resolved);
    expect(frozen.contentMarkdown).toBe(edition.pages[0]!.contentMarkdown);
    expect(frozen.visualDirections).toBe(edition.pages[0]!.visualDirections);
    expect(frozen.sourcePageIds).toEqual(["source1", "source2", "source3"]);
    expect(frozen.referenceImageUrls).toEqual(["https://example.invalid/signed/gs%3A%2F%2Ftest-bucket%2Freading%2Fu7%2Fsource3.png"]);
    expect(mocks.sign).toHaveBeenCalledWith(edition.pages[0]!.imageGsUris[0], 3600);
  });
  it("拒绝空结果及错身份结果，旧成功结果不覆盖", async () => {
    const resolved = await resolveKnowledgeCardReadingRender(7, input());
    await expect(saveKnowledgeCardReadingRenderResult(resolved, " ")).rejects.toThrow("图片为空");
    mocks.objects.set(`${resolved.prefix}/result.json`, { progressJobId: "other", status: "succeeded", imageUrl: "https://example.invalid/other.png" });
    await expect(getKnowledgeCardReadingRenderStatus(7, input())).rejects.toThrow("身份");
    mocks.objects.delete(`${resolved.prefix}/result.json`);
    await saveKnowledgeCardReadingRenderResult(resolved, "https://example.invalid/original.png");
    await expect(saveKnowledgeCardReadingRenderResult(resolved, "https://example.invalid/new.png")).rejects.toThrow("不能覆盖");
    expect((await getKnowledgeCardReadingRenderStatus(7, input())).imageUrl).toBe("https://example.invalid/original.png");
  });
});
