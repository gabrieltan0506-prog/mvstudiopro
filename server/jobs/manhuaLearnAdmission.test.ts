import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
const state = vi.hoisted(() => ({ db: null as any, isolation: [] as string[], conflicts: 0 }));
vi.mock("../db", () => ({ getDb: async () => state.db }));
import { createManhuaLearnJobWithAdmission, listManhuaTemplateLearnJobsForUser, findFailedManhuaLearnResumeEpisodes } from "./repository";
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


describe("失败恢复通道身份", () => {
  const lookup = { userId: "owner", currentJobId: "current", sourceUrl: "https://www.douyin.com/video/123",
    seriesKey: "series-g38f", episodeIndexes: [1, 2], segmentSeconds: 300, videoFps: 12 };
  const seed = async (id: string, status = "failed", owner = "owner", model = "gemini-3.8-flash", extra = {}) => {
    await pg.query(`INSERT INTO jobs (id,"userId",type,provider,status,input,output,"createdAt")
      VALUES ($1,$2,'video','test',$3,$4,$5,now() + $6 * interval '1 second')`, [id, owner, status,
      JSON.stringify({ action: "manhua_template_learn", params: { url: lookup.sourceUrl,
        nativeReadModel: model, nativeDeepReadConfirmed: true, nativeVideoFps: 12, ...extra } }),
      JSON.stringify({ nativeStoredPlan: { seriesKey: lookup.seriesKey, segmentSeconds: 300, episodes: [{ episodeIndex: 1 }] } }),
      id === "new" ? 10 : 0]);
  };
  it("本人同源最近失败只恢复重叠集；首次与跨用户没有标记", async () => {
    expect(await findFailedManhuaLearnResumeEpisodes(lookup)).toEqual([]);
    await seed("other", "failed", "other-owner");
    expect(await findFailedManhuaLearnResumeEpisodes(lookup)).toEqual([]);
    await seed("own");
    expect(await findFailedManhuaLearnResumeEpisodes(lookup)).toEqual([1]);
    expect(await findFailedManhuaLearnResumeEpisodes({ ...lookup, sourceUrl: "https://www.douyin.com/video/456" })).toEqual([]);
    expect(await findFailedManhuaLearnResumeEpisodes({ ...lookup, seriesKey: "different-g38f" })).toEqual([]);
    expect(await findFailedManhuaLearnResumeEpisodes({ ...lookup, videoFps: 10 })).toEqual([]);
    expect(await findFailedManhuaLearnResumeEpisodes({ ...lookup, segmentSeconds: 319 })).toEqual([]);
  });
  it.each(["succeeded", "running", "queued"])("后续%s挡住历史失败，不能永久强制Evolink", async status => {
    await seed("old"); await seed("new", status);
    expect(await findFailedManhuaLearnResumeEpisodes(lookup)).toEqual([]);
  });
  it("显式重学新身份和其他模型不继承，客户端自填标记不起作用", async () => {
    await seed("old", "failed", "owner", "gemini-4-argon", { nativeEvolinkOnlyEpisodeIndexes: [1] });
    expect(await findFailedManhuaLearnResumeEpisodes(lookup)).toEqual([]);
    await seed("new", "failed", "owner", "gemini-3.8-flash", { nativeRelearn: { requestId: "new-identity" } });
    expect(await findFailedManhuaLearnResumeEpisodes(lookup)).toEqual([]);
  });
  it("恢复真实301秒11fps计划，params缺字段时不套300秒12fps", async () => {
    await seed("own");
    await pg.query(`UPDATE jobs SET input = jsonb_set(input::jsonb, '{params}', (input::jsonb->'params') - 'nativeVideoFps'),
      output = jsonb_set(jsonb_set(output::jsonb, '{nativeStoredPlan,segmentSeconds}', '301'), '{nativeStoredPlan,videoFps}', '11') WHERE id = 'own'`);
    expect(await findFailedManhuaLearnResumeEpisodes({ ...lookup, segmentSeconds: 301, videoFps: 11 })).toEqual([1]);
    expect(await findFailedManhuaLearnResumeEpisodes(lookup)).toEqual([]);
  });
  it("数据库不可核实则报错，不回退首次双通道", async () => {
    state.db = null;
    await expect(findFailedManhuaLearnResumeEpisodes(lookup)).rejects.toThrow("无法核实失败续跑通道");
  });
});
