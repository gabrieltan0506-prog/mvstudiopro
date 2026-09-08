import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ job: null as any, get: vi.fn(), db: vi.fn(), update: vi.fn(), set: vi.fn(), where: vi.fn() }));
vi.mock("../db.js", () => ({ getDb: m.db }));
vi.mock("../jobs/repository.js", () => ({ getJobByIdStrict: m.get }));
import { resumeKnowledgeCardReadingJob } from "./knowledgeCardReadingResume";
const id = `kcr_${"a".repeat(48)}`;
beforeEach(() => {
  vi.clearAllMocks();
  m.job = { id, userId: "7", status: "failed", error: "失败", input: { action: "knowledge_card_reading", params: { original: "保留原输入" } }, output: { raw: "原始响应路径", readingDonePages: 273 }, attempts: 1 };
  m.get.mockImplementation(async () => structuredClone(m.job));
  m.db.mockResolvedValue({ update: m.update }); m.update.mockReturnValue({ set: m.set }); m.set.mockReturnValue({ where: m.where });
  m.where.mockImplementation(async () => { if (m.job.status === "failed") Object.assign(m.job, m.set.mock.calls.at(-1)![0]); });
});
describe("显式恢复保留同任务与原始证据", () => {
  it("只改failed状态错误更新时间，保持ID输入产物attempts，重复恢复不二次更新", async () => {
    const original = structuredClone(m.job);
    expect(await resumeKnowledgeCardReadingJob(7, id)).toEqual({ progressJobId: id, status: "queued" });
    expect(m.set.mock.calls[0]![0]).toEqual({ status: "queued", error: null, updatedAt: expect.any(Date) });
    expect(m.job).toMatchObject({ id, input: original.input, output: original.output, attempts: 1 });
    expect(await resumeKnowledgeCardReadingJob(7, id)).toEqual({ progressJobId: id, status: "queued" });
    expect(m.update).toHaveBeenCalledTimes(1);
  });
  it.each(["queued", "running", "succeeded"])("%s状态只查询不恢复", async status => {
    m.job.status = status;
    expect((await resumeKnowledgeCardReadingJob(7, id)).status).toBe(status);
    expect(m.db).not.toHaveBeenCalled();
  });
  it("非法ID、其他账号、错误action不能到数据库更新", async () => {
    await expect(resumeKnowledgeCardReadingJob(7, "other")).rejects.toThrow("编号");
    await expect(resumeKnowledgeCardReadingJob(8, id)).rejects.toThrow("当前账号");
    m.job.input.action = "other";
    await expect(resumeKnowledgeCardReadingJob(7, id)).rejects.toThrow("不属于");
    expect(m.db).not.toHaveBeenCalled();
  });
  it("数据库不可用或更新未生效不伪造已排队", async () => {
    m.db.mockResolvedValueOnce(null);
    await expect(resumeKnowledgeCardReadingJob(7, id)).rejects.toThrow("暂不可用");
    m.where.mockResolvedValue(undefined);
    await expect(resumeKnowledgeCardReadingJob(7, id)).rejects.toThrow("尚未恢复");
    expect(m.job.status).toBe("failed");
  });
  it("CAS期间其他worker已恢复运行时返回真实running，不覆盖输入", async () => {
    m.where.mockImplementation(async () => { m.job.status = "running"; });
    expect((await resumeKnowledgeCardReadingJob(7, id)).status).toBe("running");
    expect(m.set.mock.calls[0]![0]).not.toHaveProperty("input");
  });
});
