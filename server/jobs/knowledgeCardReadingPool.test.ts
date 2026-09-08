import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../services/platformImageChineseStaging.js", () => ({ omitChineseStagingFromJobOutput: (value: unknown) => value }));
vi.mock("../services/drProSecondaryStaging.js", () => ({ deleteDrProSecondaryStagingByJobId: vi.fn() }));
import { claimNextKnowledgeCardReadingJob, claimNextQueuedJob, claimNextQueuedJobExcluding } from "./repository";

const row = (action: string, type = "platform") => ({ id: "reading-job", userId: "7", type, provider: "evolink", status: "queued", input: { action }, output: null, error: null, attempts: 0, createdAt: new Date(), updatedAt: new Date() });
function sqlText(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (candidate: unknown): string => {
    if (typeof candidate === "string") return candidate;
    if (Array.isArray(candidate)) return candidate.map(walk).join(" ");
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) return "";
    seen.add(candidate);
    const object = candidate as { queryChunks?: unknown; value?: unknown };
    return [walk(object.queryChunks), walk(object.value)].join(" ");
  };
  return walk(value);
}
function database(record: ReturnType<typeof row>, successfulClaims = 1) {
  const conditions: unknown[] = [];
  const updateConditions: unknown[] = [];
  const set = vi.fn();
  const chain = { from: () => chain, where: (condition: unknown) => { conditions.push(condition); return chain; }, orderBy: () => chain, limit: async () => [record] };
  const db = { select: () => chain, update: () => ({ set: (value: unknown) => {
    set(value);
    return { where: (condition: unknown) => { updateConditions.push(condition); return { returning: async () => successfulClaims-- > 0 ? [{ id: record.id }] : [] }; } };
  } }) };
  return { db, conditions, updateConditions, set };
}
describe("阅读独立队列领取", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(["knowledge_card_reading", "knowledge_card_edition"])("%s由专用队列CAS领取", async action => {
    const fixture = database(row(action)); mocks.getDb.mockResolvedValue(fixture.db);
    expect((await claimNextKnowledgeCardReadingJob())?.id).toBe("reading-job");
    expect(sqlText(fixture.conditions[0])).toContain("knowledge_card_reading");
    expect(sqlText(fixture.conditions[0])).toContain("knowledge_card_edition");
    expect(sqlText(fixture.conditions[0])).toContain("platform");
    expect(sqlText(fixture.updateConditions[0])).toContain("queued");
    expect(fixture.set).toHaveBeenCalledWith(expect.objectContaining({ status: "running", attempts: 1 }));
  });
  it("两个实例选中同条记录，只有一个CAS成功", async () => {
    const fixture = database(row("knowledge_card_reading")); mocks.getDb.mockResolvedValue(fixture.db);
    const claimed = await Promise.all([claimNextKnowledgeCardReadingJob(), claimNextKnowledgeCardReadingJob()]);
    expect(claimed.filter(Boolean)).toHaveLength(1); expect(claimed.filter(value => value === null)).toHaveLength(1);
  });
  it("普通领取两个入口均在SQL中排除阅读与详细稿", async () => {
    const fixture = database(row("platform_build_content"), 2); mocks.getDb.mockResolvedValue(fixture.db);
    await claimNextQueuedJob(); await claimNextQueuedJobExcluding([]);
    const excluded = fixture.conditions.map(sqlText).filter(text => text.includes("not in"));
    expect(excluded).toHaveLength(2);
    for (const query of excluded) { expect(query).toContain("knowledge_card_reading"); expect(query).toContain("knowledge_card_edition"); }
  });
  it("专用队列拒绝其他动作或错误任务类型", async () => {
    for (const record of [row("platform_build_content"), row("knowledge_card_reading", "video")]) {
      const fixture = database(record); mocks.getDb.mockResolvedValue(fixture.db);
      expect(await claimNextKnowledgeCardReadingJob()).toBeNull(); expect(fixture.set).not.toHaveBeenCalled();
    }
  });
  it("数据库不可用不伪造已领取任务", async () => {
    mocks.getDb.mockResolvedValue(null); expect(await claimNextKnowledgeCardReadingJob()).toBeNull();
  });
});
