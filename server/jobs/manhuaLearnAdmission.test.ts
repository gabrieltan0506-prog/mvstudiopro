import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
const state = vi.hoisted(() => ({ db: null as any, isolation: [] as string[], conflicts: 0 }));
vi.mock("../db", () => ({ getDb: async () => state.db }));
import { createManhuaLearnJobWithAdmission, listManhuaTemplateLearnJobsForUser } from "./repository";
const pg = new PGlite();
beforeAll(async () => {
  await pg.exec(`CREATE TABLE jobs (id varchar(64) PRIMARY KEY, "userId" varchar(64) NOT NULL,
    type text NOT NULL, provider varchar(64) NOT NULL, status text NOT NULL DEFAULT 'queued',
    input json NOT NULL, output json, error text, attempts integer NOT NULL DEFAULT 0,
    "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now());`);
}, 30_000);
beforeEach(async () => {
  await pg.exec("TRUNCATE jobs"); state.isolation = []; state.conflicts = 0;
  state.db = drizzle(pg);
  state.db.$client = { transaction: async (build: any, options: any) => {
    state.isolation.push(options.isolationLevel);
    if (state.conflicts-- > 0) throw Object.assign(new Error("serialization fixture"), { code: "40001" });
    const statements = build((parts: TemplateStringsArray, ...params: unknown[]) => ({
      query: parts.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, ""), params,
    }));
    return pg.transaction(async tx => Promise.all(statements.map(async (statement: any) =>
      (await tx.query(statement.query, statement.params)).rows)));
  } };
});
afterAll(() => pg.close());
const data = (id: string, userId = "owner", action = "manhua_template_learn") =>
  ({ id, userId, type: "video" as const, provider: "test-provider", input: { action, params: { nativeDeepReadConfirmed: true } } });
describe("学习原子准入", () => {
  it("并发申请两部成功，第三部拒绝且没有占位；包含不同owner与隐藏中的真实任务", async () => {
    expect(await Promise.all([createManhuaLearnJobWithAdmission(data("a")), createManhuaLearnJobWithAdmission(data("b", "other-owner"))])).toEqual(["a", "b"]);
    await pg.query(`UPDATE jobs SET input = input::jsonb || '{"hiddenAt":"fixture"}'::jsonb WHERE id = 'a'`);
    await expect(createManhuaLearnJobWithAdmission(data("c"))).rejects.toMatchObject({ code: "MANHUA_LEARN_CAPACITY_FULL" });
    expect((await pg.query("SELECT id FROM jobs ORDER BY id")).rows).toEqual([{ id: "a" }, { id: "b" }]);
    expect(state.isolation.every(value => value === "Serializable")).toBe(true);
  });
  it("同job同owner幂等不占第三槽；跨owner不能冒用，其他非学习不受限", async () => {
    await createManhuaLearnJobWithAdmission(data("a")); await createManhuaLearnJobWithAdmission(data("b"));
    expect(await createManhuaLearnJobWithAdmission(data("a"))).toBe("a");
    await expect(createManhuaLearnJobWithAdmission(data("a", "other-owner"))).rejects.toThrow();
    expect(await createManhuaLearnJobWithAdmission(data("not-learning", "owner", "growth_analyze_video"))).toBe("not-learning");
  });
  it("真实终态释放名额，可串行化冲突只重试免费准入，不重复建单", async () => {
    await createManhuaLearnJobWithAdmission(data("a")); await createManhuaLearnJobWithAdmission(data("b"));
    await pg.query("UPDATE jobs SET status = 'succeeded' WHERE id = 'a'");
    state.conflicts = 1;
    expect(await createManhuaLearnJobWithAdmission(data("c"))).toBe("c");
    expect((await pg.query("SELECT count(*) AS n FROM jobs WHERE id = 'c'")).rows[0]).toEqual({ n: 1 });
  });
  it("按页面jobId精确恢复本人旧任务，不受列表最近条数影响，也不读其他owner", async () => {
    await createManhuaLearnJobWithAdmission(data("own-old"));
    await createManhuaLearnJobWithAdmission(data("other", "other-owner"));
    await pg.query("UPDATE jobs SET status = 'succeeded' WHERE id = 'own-old'");
    await createManhuaLearnJobWithAdmission(data("own-new"));
    expect((await listManhuaTemplateLearnJobsForUser("owner", 1, "own-old")).map(row => row.id)).toEqual(["own-old"]);
    expect(await listManhuaTemplateLearnJobsForUser("owner", 30, "other")).toEqual([]);
  });
  it("数据库不可确认时关闭准入", async () => {
    state.db = null;
    await expect(createManhuaLearnJobWithAdmission(data("a"))).rejects.toThrow("cannot admit");
  });
});
