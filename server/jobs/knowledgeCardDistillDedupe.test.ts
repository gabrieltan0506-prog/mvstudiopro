import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: async () => state.db }));
import { createKnowledgeCardDistillJob, cancelKnowledgeCardPageRequest, knowledgeCardPageJobId } from "./knowledgeCardPageTask";
import { knowledgeCardDistillSourceKey } from "../services/knowledgeCardDistillSourceKey";

const pg = new PGlite();
/** 与生产同一调用形态：$client.transaction(tx => [tx.query(...)], { isolationLevel }) */
const client = {
  transaction: async (fn: (tx: { query: (t: string, p: unknown[]) => unknown }) => Array<{ t: string; p: unknown[] }>, opts: { isolationLevel?: string }) => {
    const queries = fn({ query: (t, p) => ({ t, p }) }) as Array<{ t: string; p: unknown[] }>;
    return pg.transaction(async tx => {
      if (opts?.isolationLevel === "Serializable") await tx.exec("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const out: unknown[] = [];
      for (const q of queries) out.push((await tx.query(q.t, q.p as any[])).rows);
      return out;
    });
  },
};
const uuid = (n: number) => `13304dee-9292-4a81-923d-${String(n).padStart(12, "0")}`;
const params = { sourceText: "", distillModel: "m1", detailLevel: "full", billingPolicy: "interior-pages-v1", files: [{ gcsUri: "gs://b/uploads/u1/a.epub", mimeType: "application/epub+zip" }], chargeDistillFee: false };
const rows = async () => (await pg.query<{ id: string; userId: string; status: string; input: any }>(`SELECT id, "userId", status, input FROM jobs ORDER BY "createdAt"`)).rows;
const setRow = (id: string, sql: string) => pg.query(`UPDATE jobs SET ${sql} WHERE id = $1`, [id]);

beforeAll(async () => {
  await pg.exec(`CREATE TABLE jobs (id varchar(64) PRIMARY KEY, "userId" varchar(64) NOT NULL, type text NOT NULL, provider varchar(64) NOT NULL,
    status text NOT NULL DEFAULT 'queued', input json NOT NULL, output json, error text, attempts integer NOT NULL DEFAULT 0,
    "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now());`);
}, 30_000);
beforeEach(async () => {
  const db = drizzle(pg);
  Object.defineProperty(db, "$client", { value: client, configurable: true });
  state.db = db;
  delete process.env.JOBS_STALE_MINUTES; delete process.env.JOBS_STALE_RUNNING_MINUTES; delete process.env.JOBS_STALE_QUEUED_HOURS;
  await pg.exec("TRUNCATE jobs");
});
afterAll(() => pg.close());

describe("读档同源在途去重（真实 Postgres 语义）", () => {
  it("同一用户同一原稿：第一单排队或运行中，第二页不建新单，回原任务编号", async () => {
    const first = await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(1), params, dedupeKey: "K" });
    expect(first).toEqual({ id: knowledgeCardPageJobId("1", "knowledge_card_distill", uuid(1)), attachedToExistingJob: false });
    const second = await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(2), params, dedupeKey: "K" });
    expect(second).toEqual({ id: first.id, attachedToExistingJob: true });
    await setRow(first.id, `status = 'running', "updatedAt" = now()`);
    const third = await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(3), params, dedupeKey: "K" });
    expect(third).toEqual({ id: first.id, attachedToExistingJob: true });
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0].input).toMatchObject({ action: "knowledge_card_distill", dedupeKey: "K", params: { distillModel: "m1" } });
  });

  it("不同用户、不同原稿或不同设置（身份键不同）都建新单", async () => {
    const a = await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(1), params, dedupeKey: "K" });
    const b = await createKnowledgeCardDistillJob({ userId: "2", requestId: uuid(2), params, dedupeKey: "K" });
    const c = await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(3), params, dedupeKey: "K-other-source" });
    const d = await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(4), params: { ...params, detailLevel: "concise" }, dedupeKey: "K-other-level" });
    expect([a, b, c, d].map(x => x.attachedToExistingJob)).toEqual([false, false, false, false]);
    expect(new Set([a.id, b.id, c.id, d.id]).size).toBe(4);
    expect(await rows()).toHaveLength(4);
  });

  it.each(["succeeded", "failed"])("上一单已%s：不挡新提交", async status => {
    const a = await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(1), params, dedupeKey: "K" });
    await setRow(a.id, `status = '${status}'`);
    const b = await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(2), params, dedupeKey: "K" });
    expect(b.attachedToExistingJob).toBe(false);
    expect(b.id).not.toBe(a.id);
  });

  it("上一单已请求停止（运行中收尾）：不挡新提交", async () => {
    const a = await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(1), params, dedupeKey: "K" });
    await setRow(a.id, `status = 'running'`);
    await cancelKnowledgeCardPageRequest({ userId: "1", action: "knowledge_card_distill", requestId: uuid(1) }).catch(() => null);
    await setRow(a.id, `input = (input::jsonb || '{"cancelRequestedAt":"2026-11-14T00:00:00Z"}'::jsonb)::json`);
    const b = await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(2), params, dedupeKey: "K" });
    expect(b.attachedToExistingJob).toBe(false);
  });

  it("运行中但心跳超过僵尸窗口（进程已崩）：允许新提交；窗口内仍跟进", async () => {
    const a = await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(1), params, dedupeKey: "K" });
    await setRow(a.id, `status = 'running', "updatedAt" = now() - interval '19 minutes'`);
    expect((await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(2), params, dedupeKey: "K" })).attachedToExistingJob).toBe(true);
    await setRow(a.id, `"updatedAt" = now() - interval '21 minutes', "createdAt" = now() - interval '2 hours'`);
    const c = await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(3), params, dedupeKey: "K" });
    expect(c).toEqual({ id: knowledgeCardPageJobId("1", "knowledge_card_distill", uuid(3)), attachedToExistingJob: false });
  });

  it("久未领取的排队单同样不挡；同请求编号重试仍是原单、刷新占位不被复活", async () => {
    const a = await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(1), params, dedupeKey: "K" });
    await setRow(a.id, `"createdAt" = now() - interval '30 minutes', "updatedAt" = now() - interval '30 minutes'`);
    const b = await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(2), params, dedupeKey: "K" });
    expect(b.attachedToExistingJob).toBe(false);
    // 同一请求编号重试：返回自己那单，不跟进别人
    expect(await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(2), params, dedupeKey: "K" })).toEqual({ id: b.id, attachedToExistingJob: false });
    // 先刷新后迟到提交：占位保持 failed，不复活也不跟进
    await cancelKnowledgeCardPageRequest({ userId: "1", action: "knowledge_card_distill", requestId: uuid(9) }).catch(() => null);
    const late = await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(9), params, dedupeKey: "K" });
    expect(late.attachedToExistingJob).toBe(false);
    expect((await rows()).find(r => r.id === late.id)?.status).toBe("failed");
  });

  it("没有可靠身份时不去重，沿用原建单", async () => {
    await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(1), params, dedupeKey: "K" });
    const b = await createKnowledgeCardDistillJob({ userId: "1", requestId: uuid(2), params, dedupeKey: null });
    expect(b.attachedToExistingJob).toBe(false);
    expect(await rows()).toHaveLength(2);
  });
});

describe("原稿身份键", () => {
  const base = { sourceText: "", distillModel: "m1", detailLevel: "full", billingPolicy: "interior-pages-v1", chargeDistillFee: false };
  const file = (gcsUri: string, fileName = "书.epub") => ({ gcsUri, mimeType: "application/epub+zip", fileName });
  it("两页各自直传（地址不同）同一内容 ⇒ 同键；只读元数据", async () => {
    const stat = vi.fn(async () => ({ byteLength: 85_000_000, crc32c: "abc==" }));
    const a = await knowledgeCardDistillSourceKey({ ...base, files: [file("gs://b/uploads/u1/x1.epub")] }, { stat });
    const b = await knowledgeCardDistillSourceKey({ ...base, files: [file("gs://b/uploads/u1/x2.epub", "改名.epub")] }, { stat });
    expect(a).toEqual({ key: b!.key, basis: "content" });
    expect(stat).toHaveBeenCalledTimes(2);
  });
  it("内容、档位、成稿档、计费口径任一不同 ⇒ 不同键", async () => {
    const stat = vi.fn(async ({ gcsUri }: { gcsUri: string }) => ({ byteLength: 10, crc32c: gcsUri.endsWith("y") ? "other" : "abc" }));
    const k = async (extra: Record<string, unknown>, uri = "gs://b/x") => (await knowledgeCardDistillSourceKey({ ...base, files: [file(uri)], ...extra } as any, { stat }))!.key;
    const keys = [await k({}), await k({}, "gs://b/y"), await k({ distillModel: "m2" }), await k({ detailLevel: "concise" }), await k({ billingPolicy: undefined }), await k({ chargeDistillFee: true })];
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("存储端没给校验和 ⇒ 退回文件名+字节数；元数据取不到 ⇒ 不去重", async () => {
    const noCrc = await knowledgeCardDistillSourceKey({ ...base, files: [file("gs://b/x")] }, { stat: async () => ({ byteLength: 10 }) });
    expect(noCrc?.basis).toBe("name-size");
    expect(await knowledgeCardDistillSourceKey({ ...base, files: [file("gs://b/x")] }, { stat: async () => { throw new Error("gcs_stat_failed:503"); } })).toBeNull();
  });
  it("粘贴正文按全文哈希", async () => {
    const a = await knowledgeCardDistillSourceKey({ ...base, sourceText: "正文A" });
    const b = await knowledgeCardDistillSourceKey({ ...base, sourceText: " 正文A " });
    const c = await knowledgeCardDistillSourceKey({ ...base, sourceText: "正文B" });
    expect(a).toEqual({ key: b!.key, basis: "text" });
    expect(c!.key).not.toBe(a!.key);
  });
});
