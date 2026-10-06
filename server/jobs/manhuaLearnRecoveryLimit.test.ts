import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { jobs } from "../../drizzle/schema-jobs";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: async () => state.db }));
import {
  claimNextManhuaTemplateLearnJob,
  recoverInterruptedManhuaTemplateLearnJobsOnStartup,
} from "./repository";

const pg = new PGlite();
beforeAll(async () => {
  await pg.exec(`CREATE TABLE jobs (id varchar(64) PRIMARY KEY, "userId" varchar(64) NOT NULL,
    type text NOT NULL, provider varchar(64) NOT NULL, status text NOT NULL DEFAULT 'queued',
    input json NOT NULL, output json, error text, attempts integer NOT NULL DEFAULT 0,
    "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now());`);
}, 30_000);
beforeEach(async () => {
  state.db = drizzle(pg);
  await pg.exec("TRUNCATE jobs");
});
afterAll(() => pg.close());

async function seed(id: string, attempts: number, status = "running", input: Record<string, unknown> = {}, output: unknown = { checkpoint: "保留证据" }) {
  await state.db.insert(jobs).values({ id, userId: "test-user", type: "video", provider: "test-provider",
    status, attempts, input: { action: "manhua_template_learn", ...input }, output });
}
async function row(id: string) {
  return (await pg.query("SELECT * FROM jobs WHERE id = $1", [id])).rows[0];
}

describe("学习重启恢复八次领取上限：真实离线 Postgres", () => {
  it.each([2, 7])("已领取 %i 次的中断任务可继续，保留检查点并只增加一次领取", async attempts => {
    await seed("learn", attempts);
    expect(await recoverInterruptedManhuaTemplateLearnJobsOnStartup()).toEqual({ requeued: 1, cancelled: 0, completed: 0, exhausted: 0 });
    expect(await claimNextManhuaTemplateLearnJob()).toMatchObject({ id: "learn", attempts: attempts + 1, output: { checkpoint: "保留证据" } });
    expect(await claimNextManhuaTemplateLearnJob()).toBeNull();
  });

  it.each(["running", "queued"])("已领取8次的 %s 任务终止，不能再领取", async status => {
    await seed("exhausted", 8, status);
    expect(await claimNextManhuaTemplateLearnJob()).toBeNull();
    expect(await recoverInterruptedManhuaTemplateLearnJobsOnStartup()).toEqual({ requeued: 0, cancelled: 0, completed: 0, exhausted: 1 });
    expect(await row("exhausted")).toMatchObject({ status: "failed", attempts: 8, output: { checkpoint: "保留证据" } });
    expect(await claimNextManhuaTemplateLearnJob()).toBeNull();
  });

  it("取消优先终止，已完成优先成功，旧失败任务不会因放宽上限复活", async () => {
    await seed("cancelled", 7, "running", { cancelRequestedAt: "2026-10-06T12:00:00Z" });
    await seed("done", 8, "running", {}, { analysisStage: "manhua_learn_done", checkpoint: "保留证据" });
    await seed("old-failed", 2, "failed");
    expect(await recoverInterruptedManhuaTemplateLearnJobsOnStartup()).toEqual({ requeued: 0, cancelled: 1, completed: 1, exhausted: 0 });
    expect(await row("cancelled")).toMatchObject({ status: "failed", error: "用户已停止学习；已落盘内容保留" });
    expect(await row("done")).toMatchObject({ status: "succeeded", error: null });
    expect(await row("old-failed")).toMatchObject({ status: "failed", attempts: 2 });
    expect(await claimNextManhuaTemplateLearnJob()).toBeNull();
  });

  it("不会领取隐藏任务或其他任务类型，首次领取计为1", async () => {
    await seed("hidden", 2, "queued", { hiddenAt: "2026-10-06T12:00:00Z" });
    await seed("other", 2, "queued", { action: "other_action" });
    await seed("fresh", 0, "queued");
    expect(await claimNextManhuaTemplateLearnJob()).toMatchObject({ id: "fresh", attempts: 1 });
    expect(await claimNextManhuaTemplateLearnJob()).toBeNull();
    expect(await row("other")).toMatchObject({ status: "queued", attempts: 2 });
  });
});
