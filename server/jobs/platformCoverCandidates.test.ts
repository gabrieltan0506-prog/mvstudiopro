import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { CREDIT_COSTS } from "../../shared/plans";
const state = vi.hoisted(() => ({ db: null as any, charges: [] as string[], refunds: [] as string[], generated: [] as any[], fail: false }));
vi.mock("../db", () => ({ getDb: async () => state.db }));
vi.mock("../credits", () => ({ getCredits: async () => ({ totalAvailable: 9999 }),
  deductCreditsAmount: async (_u: number, _c: number, _a: string, _d: string, opts: any) => { state.charges.push(opts.chargeKey); return { success: true }; },
  refundChargeByKey: async (input: any) => { state.refunds.push(input.chargeKey); return { refunded: 48 }; },
}));
vi.mock("../services/platformStrategicBlueprintSnapshots", () => ({ assertOptimizedCoverInputsFromDb: async () => ({ topicHook: "真实视频内容", context: "真实人物在广场喝咖啡，叙事内容被冻结", format: "短视频", appealHook: "慢下来" }) }));
vi.mock("../services/runPlatformTopicImagePipeline", () => ({ runPlatformTopicImagePipeline: async (input: any) => { state.generated.push(input); return { success: true, imageUrl: `https://images.invalid/${state.generated.length}.png` }; } }));
vi.mock("../services/platformCoverGrade", () => ({ postProcessPlatformCover: async (url: string, user: number, style: string) => {
  if (state.fail && style === "natural") throw Error("grade fail");
  return { originalUrl: `gs://test/u${user}/original-${style}.png`, imageUrl: `gs://test/u${user}/grade-${style}.png`, receiptUrl: `gs://test/u${user}/${style}.json` };
} }));
vi.mock("../services/gcs", () => ({ signGsUriV4ReadUrl: (uri: string) => uri.replace("gs://", "https://signed.invalid/") }));
import { enqueueCoverCandidates, getCoverCandidates, processCoverCandidatesJob, selectCoverCandidate, resumeCoverCandidates } from "./platformCoverCandidates";
const pg = new PGlite(), db = drizzle(pg);
beforeAll(async () => {
  state.db = db;
  await db.execute(sql`CREATE TABLE jobs(id varchar(64) PRIMARY KEY, "userId" varchar(64) NOT NULL, type text NOT NULL, provider text NOT NULL, status text NOT NULL DEFAULT 'queued', input json NOT NULL, output json, error text, attempts integer NOT NULL DEFAULT 0, "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now())`);
  await db.execute(sql`CREATE TABLE user_creations(id serial PRIMARY KEY, "userId" integer NOT NULL, type text, title text, "outputUrl" text, "secondaryUrl" text, metadata text, status text, "creditsUsed" integer, "createdAt" timestamp DEFAULT now(), "updatedAt" timestamp DEFAULT now())`);
}, 30000);
beforeEach(async () => { await db.execute(sql`TRUNCATE jobs, user_creations`); state.charges = []; state.refunds = []; state.generated = []; state.fail = false; });
afterAll(() => pg.close());
const request = (id = "request-123456", sceneId = "scene1") => ({ sceneId, requestId: id, expectedCredits: CREDIT_COSTS.platformTopicFrameGraphic * 3 });
async function run(jobId: string) {
  await db.execute(sql`UPDATE jobs SET status='running' WHERE id=${jobId}`);
  const result = await processCoverCandidatesJob(jobId, "1");
  await db.execute(sql`UPDATE jobs SET status='succeeded', output=${JSON.stringify(result.output)}::json WHERE id=${jobId}`);
  return result;
}
it("并发提交同一内容只入一单，同请求重发复用且未提前扣费", async () => {
  const results = await Promise.allSettled([enqueueCoverCandidates(1, false, request()), enqueueCoverCandidates(1, false, request("request-654321"))]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect((await db.execute(sql`SELECT count(*)::int n FROM jobs`)).rows).toEqual([{ n: 1 }]);
  expect(state.charges).toEqual([]);
  const ok = results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<any>;
  const retryId = results[0].status === "fulfilled" ? "request-123456" : "request-654321";
  expect(await enqueueCoverCandidates(1, false, request(retryId))).toMatchObject({ jobId: ok.value.jobId, reused: true });
});
it("真实SQL：三份结果不自动采用，采用与记录原子写入并按账号恢复", async () => {
  const { jobId } = await enqueueCoverCandidates(1, false, request());
  await run(jobId);
  expect(state.generated).toHaveLength(3);
  expect(new Set(state.generated.map(i => i.coverDesignInstruction)).size).toBe(3);
  expect(state.generated.every(i => i.context.includes("被冻结"))).toBe(true);
  expect(state.charges).toHaveLength(3);
  expect((await getCoverCandidates(1, "scene1")).adoptedUrl).toBeNull();
  await expect(selectCoverCandidate(2, jobId, "story")).rejects.toThrow("无权");
  const selected = await selectCoverCandidate(1, jobId, "subject");
  expect(selected.imageUrl).toContain("grade-soft.png");
  expect(await selectCoverCandidate(1, jobId, "subject")).toEqual(selected);
  const refreshed = await getCoverCandidates(1, "scene1");
  expect(refreshed.set?.selectedId).toBe("subject"); expect(refreshed.adoptedUrl).toBe(selected.imageUrl);
  expect((await getCoverCandidates(2, "scene1")).set).toBeNull();
  expect((await db.execute(sql`SELECT "outputUrl", "secondaryUrl" FROM user_creations`)).rows).toEqual([{ outputUrl: "gs://test/u1/grade-soft.png", secondaryUrl: "gs://test/u1/original-soft.png" }]);
});
it("后期失败退该张，恢复不生图不扣费，新批次不覆盖旧选择", async () => {
  const { jobId } = await enqueueCoverCandidates(1, false, request()); state.fail = true;
  await run(jobId);
  await expect(selectCoverCandidate(1, jobId, "story")).rejects.toThrow("调色");
  await selectCoverCandidate(1, jobId, "subject");
  const before = await getCoverCandidates(1, "scene1");
  expect(state.refunds).toHaveLength(1); state.fail = false;
  await resumeCoverCandidates(1, jobId); await run(jobId);
  expect(state.generated).toHaveLength(3); expect(state.charges).toHaveLength(3);
  expect((await getCoverCandidates(1, "scene1")).set?.candidates[0].status).toBe("ready");
  await enqueueCoverCandidates(1, false, request("request-next-123"));
  expect((await getCoverCandidates(1, "scene1")).adoptedUrl).toBe(before.adoptedUrl);
});
it("费用篡改与跨账号恢复在供应商调用前拒绝", async () => {
  await expect(enqueueCoverCandidates(1, false, { ...request(), expectedCredits: 0 })).rejects.toThrow("费用");
  const { jobId } = await enqueueCoverCandidates(1, false, request());
  await expect(resumeCoverCandidates(2, jobId)).rejects.toThrow("无权");
  expect(state.generated).toEqual([]);
});
