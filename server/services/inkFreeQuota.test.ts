import { afterAll, beforeAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { ensureInkFreeTable, enqueueInkFree, quoteInkFree, assertInkFreeJob, type InkFreeJob } from "./inkFreeQuota";
const pg = new PGlite();
const db = drizzle(pg);
const source = (ip: string, day = "2026-10-11") => ({ day, ipHash: ip.padEnd(64, "0") });
const job = (user: string, id = user): InkFreeJob => ({ id: `test-ink-${id}`, userId: user, format: "mp4", input: { action: "art_motion", text: "测试内容" }, provider: "test-only", type: "post_prod" });
beforeAll(async () => {
  await db.execute(sql`CREATE TABLE jobs(id text PRIMARY KEY, "userId" text, type text, provider text, status text, input json, attempts integer)`);
  await ensureInkFreeTable(db);
}, 30_000);
afterAll(() => pg.close());
it("真实Postgres语义：并发十一个账号最多十个名额，名额与任务一起写入", async () => {
  const results = await Promise.allSettled(Array.from({ length: 11 }, (_, i) => enqueueInkFree(job(String(i)), source(String(i)), db)));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(10);
  expect((await db.execute(sql`SELECT count(*)::int AS n FROM ink_free_claims`)).rows[0]).toEqual({ n: 10 });
  expect((await db.execute(sql`SELECT count(*)::int AS n FROM jobs`)).rows[0]).toEqual({ n: 10 });
});
it("同任务恢复不占第二次；换内容、换账号不得复用原任务", async () => {
  expect(await enqueueInkFree(job("0"), source("0"), db)).toMatchObject({ jobId: job("0").id, cost: 0 });
  await expect(enqueueInkFree({ ...job("0"), input: { text: "不同内容" } }, source("0"), db)).rejects.toThrow("不一致");
  await expect(enqueueInkFree(job("other", "0"), source("9"), db)).rejects.toThrow("不一致");
});
it("次日不重置账号福利，PPT与MP4共用；同IP当天阻止第二个账号", async () => {
  await db.execute(sql`UPDATE jobs SET status='succeeded' WHERE id=${job("0").id}`);
  expect(await quoteInkFree("0", source("new-ip", "2026-10-12"), db)).toMatchObject({ reason: "account_used", eligible: false });
  await expect(enqueueInkFree({ ...job("0", "new-ppt"), format: "pptx", type: "platform" }, source("new-ip", "2026-10-12"), db)).rejects.toThrow("唯一一次");
  expect(await quoteInkFree("another", source("0"), db)).toMatchObject({ reason: "ip_used" });
});
it("只有数据库终态失败才释放；任务缺失或运行中不释放", async () => {
  await db.execute(sql`UPDATE jobs SET status='failed' WHERE id=${job("1").id}`);
  expect(await quoteInkFree("1", source("1"), db)).toMatchObject({ eligible: true });
  await enqueueInkFree(job("1", "retry-manual"), source("1"), db);
  await expect(assertInkFreeJob("1", job("1", "retry-manual").id, "mp4", db)).resolves.toBeUndefined();
  await expect(assertInkFreeJob("2", job("1", "retry-manual").id, "mp4", db)).rejects.toThrow("名额");
  await db.execute(sql`DELETE FROM jobs WHERE id=${job("2").id}`);
  expect(await quoteInkFree("2", source("2"), db)).toMatchObject({ eligible: false, reason: "account_pending" });
});
