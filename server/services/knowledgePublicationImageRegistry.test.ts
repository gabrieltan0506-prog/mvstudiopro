import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

// 假数据库：记录每次查询的列与条件（渲染成 SQL 断言），返回按「本人 + 成功 + 指定编号」过滤后的行。
const db = vi.hoisted(() => ({ queries: [] as { columns: string[]; sql: string; params: unknown[] }[], rows: [] as { id: string; userId: string; status: string; output: unknown }[] }));
vi.mock("../db", () => ({
  getDb: async () => ({
    select: (columns: Record<string, unknown>) => ({
      from: () => ({
        where: async (where: any) => {
          const { sql, params } = new PgDialect().sqlToQuery(where);
          db.queries.push({ columns: Object.keys(columns), sql, params });
          const [userId, status, ...ids] = params as string[];
          return db.rows.filter(r => r.userId === userId && r.status === status && ids.includes(r.id)).map(r => ({ id: r.id, output: r.output }));
        },
      }),
    }),
  }),
}));
vi.mock("./gcs", async importOriginal => ({ ...await importOriginal<any>(), getGcsBucketName: () => "test" }));
import * as jobsRepo from "../jobs/repository";
import { resolveKnowledgePublicationImages } from "./knowledgePublicationImages";

const imageJob = (id: string, userId: string, status: string, url: string) => ({ id, userId, status, input: { action: "platform_composite_sheet_progress", params: { kind: "single_page_knowledge_card" } }, output: { compositeImageUrl: url } });
const source = (n: number) => ({ title: "书", pages: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, headline: "h", body: "b", imageUrl: "", imageJobId: `job-${i}`, role: "illustration" as const })) });
let table: Map<string, ReturnType<typeof imageJob>>;
beforeEach(() => {
  db.queries = []; table = new Map();
  vi.spyOn(jobsRepo, "getJobByIdStrict").mockImplementation(async id => (table.get(id) ?? null) as any);
});
const put = (job: ReturnType<typeof imageJob>, registry = job) => { table.set(job.id, job); db.rows.push({ id: registry.id, userId: registry.userId, status: registry.status, output: registry.output }); };

describe("配图归属按任务编号定向核对", () => {
  beforeEach(() => { db.rows = []; });
  it("56 张图只发一次定向查询、只取 id/output、条件含本人与成功；不扫描其它任务", async () => {
    for (let i = 0; i < 56; i++) put(imageJob(`job-${i}`, "7", "succeeded", `gs://test/knowledge/7/${i}.png`));
    db.rows.push({ id: "distill-huge", userId: "7", status: "succeeded", output: { manuscript: "x".repeat(10) } });
    const out = await resolveKnowledgePublicationImages(7, source(56));
    expect(out.pages.map(p => p.imageUrl)).toEqual(Array.from({ length: 56 }, (_, i) => `gs://test/knowledge/7/${i}.png`));
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0].columns).toEqual(["id", "output"]);
    expect(db.queries[0].sql).toMatch(/"userId" = \$1 and "jobs"\."status" = \$2 and "jobs"\."id" in/);
    expect(db.queries[0].params.slice(0, 2)).toEqual(["7", "succeeded"]);
    expect(db.queries[0].params).not.toContain("distill-huge");
    // 单批只查本批的图
    db.queries = [];
    await resolveKnowledgePublicationImages(7, source(56), [3]);
    expect(db.queries[0].params.slice(2)).toEqual(["job-3"]);
  });
  it("补图绑定后按替换任务编号查询", async () => {
    put(imageJob("job-new", "7", "succeeded", "gs://test/knowledge/7/new.png"));
    const out = await resolveKnowledgePublicationImages(7, source(1), undefined, undefined, { "job-0": "job-new" });
    expect(out.pages[0].imageUrl).toBe("gs://test/knowledge/7/new.png");
    expect(db.queries[0].params.slice(2)).toEqual(["job-new"]);
  });
  it("他人任务、未成功任务仍被拒", async () => {
    put(imageJob("job-0", "9", "succeeded", "gs://test/knowledge/9/0.png"));
    await expect(resolveKnowledgePublicationImages(7, source(1))).rejects.toThrow("不属于");
    table.clear(); db.rows = [];
    put(imageJob("job-0", "7", "running", "gs://test/knowledge/7/0.png"));
    await expect(resolveKnowledgePublicationImages(7, source(1))).rejects.toThrow("仍在生成");
  });
  it("任务读到成功但登记簿不认（他人/未成功行被定向查询滤掉）时拒绝，不放宽", async () => {
    // 读任务时看到本人成功，登记查询按 userId/status 过滤后无此行（如登记属于他人）：必须拒
    put(imageJob("job-0", "7", "succeeded", "gs://test/knowledge/9/stolen.png"), imageJob("job-0", "9", "succeeded", "gs://test/knowledge/9/stolen.png"));
    await expect(resolveKnowledgePublicationImages(7, source(1))).rejects.toThrow("素材尚未登记");
    table.clear(); db.rows = [];
    put(imageJob("job-0", "7", "succeeded", "gs://test/knowledge/7/0.png"), imageJob("job-0", "7", "failed", "gs://test/knowledge/7/0.png"));
    await expect(resolveKnowledgePublicationImages(7, source(1))).rejects.toThrow("素材尚未登记");
  });
});
