import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: async () => state.db }));
import {
  createKnowledgeCardDistillJob, cancelKnowledgeCardPageRequest, knowledgeCardPageJobId, resolveKnowledgeCardFollowJob, detachKnowledgeCardFollow,
  hasLiveKnowledgeCardFollowers, isKnowledgeCardFollowJob, KNOWLEDGE_CARD_FOLLOW_ACTION, KNOWLEDGE_CARD_FOLLOW_DETACHED_MESSAGE, KNOWLEDGE_CARD_STOPPED_ELSEWHERE_MESSAGE,
} from "./knowledgeCardPageTask";
import { claimNextQueuedJob, getJobByIdStrict, requestPlatformJobCancel } from "./repository";
import { reapStaleJobsOnce } from "./staleJobsReaper";
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

const own = (u: string, n: number) => knowledgeCardPageJobId(u, "knowledge_card_distill", uuid(n));
const submit = (u: string, n: number, key: string | null = "K", p: Record<string, unknown> = params) =>
  createKnowledgeCardDistillJob({ userId: u, requestId: uuid(n), params: p, dedupeKey: key });
const row = async (id: string) => (await rows()).find(r => r.id === id);

describe("读档同源在途去重（真实 Postgres 语义）", () => {
  it("同一用户同一原稿：第一单排队或运行中，第二页不建新单，只落跟进记录指向原任务", async () => {
    const first = await submit("1", 1);
    expect(first).toEqual({ id: own("1", 1), attachedTo: null });
    expect(await submit("1", 2)).toEqual({ id: own("1", 2), attachedTo: first.id });
    await setRow(first.id, `status = 'running', "updatedAt" = now()`);
    expect(await submit("1", 3)).toEqual({ id: own("1", 3), attachedTo: first.id });
    // 同一跟进页重试提交：仍是同一条跟进记录
    expect(await submit("1", 2)).toEqual({ id: own("1", 2), attachedTo: first.id });
    const all = await rows();
    expect(all.filter(r => r.input.action === "knowledge_card_distill")).toHaveLength(1);
    expect(all.filter(r => r.input.action === KNOWLEDGE_CARD_FOLLOW_ACTION).map(r => [r.status, r.input.attachedTo])).toEqual([["following", first.id], ["following", first.id]]);
    // 跟进记录不带原稿参数，不是计费身份
    expect((await row(own("1", 2)))!.input.params).toBeUndefined();
  });

  it("跟进记录不会被执行器领走、不会被僵尸清理器删除、不计入在途", async () => {
    const first = await submit("1", 1);
    await setRow(first.id, `status = 'succeeded'`);
    const second = await submit("1", 2);
    await setRow(second.id, `status = 'running'`);
    await submit("1", 3);
    await setRow(own("1", 3), `"updatedAt" = now() - interval '3 days', "createdAt" = now() - interval '3 days'`);
    await setRow(second.id, `status = 'succeeded'`);
    // 对照：同时放一条真排队单和一条过期的普通运行单，证明执行器与清理器确实跑过
    await pg.query(`INSERT INTO jobs (id, "userId", type, provider, status, input) VALUES ('real-queued', '9', 'platform', 'evolink', 'queued', '{"action":"platform_topic_expand"}'::json)`);
    await pg.query(`INSERT INTO jobs (id, "userId", type, provider, status, input, "updatedAt") VALUES ('zombie', '9', 'image', 'evolink', 'running', '{"action":"x"}'::json, now() - interval '3 days')`);
    expect((await claimNextQueuedJob())?.id).toBe("real-queued");
    expect(await claimNextQueuedJob()).toBeNull();
    await reapStaleJobsOnce({ bypassDisable: true });
    expect(await row("zombie")).toBeUndefined();
    expect((await row(own("1", 3)))?.status).toBe("following");
    // 跟进记录本身不让后来的提交挂到它身上
    await setRow(own("1", 3), `"updatedAt" = now()`);
    expect((await submit("1", 4)).attachedTo).toBeNull();
  });

  it("第二页回执丢失：轮询本页自己的编号即跟到原任务进度与结果，并续跟进心跳", async () => {
    const first = await submit("1", 1);
    await submit("1", 2); // 回包没收到，前端只知道 own("1",2)
    await setRow(first.id, `status = 'running', output = '{"distillPercent":40}'::json`);
    await setRow(own("1", 2), `"updatedAt" = now() - interval '2 minutes'`);
    const pointer = await getJobByIdStrict(own("1", 2));
    expect(isKnowledgeCardFollowJob(pointer)).toBe(true);
    expect(await resolveKnowledgeCardFollowJob(pointer as any)).toMatchObject({ status: "running", output: { distillPercent: 40 } });
    expect(await hasLiveKnowledgeCardFollowers("1", first.id)).toBe(true);
    await setRow(first.id, `status = 'succeeded', output = '{"distilledMarkdown":"成稿"}'::json`);
    expect(await resolveKnowledgeCardFollowJob((await getJobByIdStrict(own("1", 2))) as any)).toMatchObject({ status: "succeeded", output: { distilledMarkdown: "成稿" } });
  });

  it("2a 跟进页按停止或离页：只解除本页跟进，原任务继续；中性提示", async () => {
    const first = await submit("1", 1);
    await setRow(first.id, `status = 'running'`);
    await submit("1", 2);
    await submit("1", 3);
    // 离页信标（非主动）
    const left = await cancelKnowledgeCardPageRequest({ userId: "1", action: "knowledge_card_distill", requestId: uuid(2) });
    expect(left).toMatchObject({ followDetached: true, status: "failed" });
    // 面板停止（主动）走按编号停止路由同一函数
    expect(await detachKnowledgeCardFollow({ userId: "1", jobId: own("1", 3) })).toMatchObject({ followDetached: true });
    const original = await row(first.id);
    expect(original?.status).toBe("running");
    expect(original?.input.cancelRequestedAt).toBeUndefined();
    expect(await resolveKnowledgeCardFollowJob((await getJobByIdStrict(own("1", 2))) as any)).toEqual({ status: "failed", error: KNOWLEDGE_CARD_FOLLOW_DETACHED_MESSAGE });
    expect(await hasLiveKnowledgeCardFollowers("1", first.id)).toBe(false);
    // 解除后原始页离开：没有跟进者，保持原行为（停止）
    await cancelKnowledgeCardPageRequest({ userId: "1", action: "knowledge_card_distill", requestId: uuid(1) });
    expect((await row(first.id))?.input.cancelRequestedAt).toBeTruthy();
  });

  it("2b 原始页离页/刷新：有活着的跟进页则不停任务；跟进记录过期则照常停止", async () => {
    const first = await submit("1", 1);
    await setRow(first.id, `status = 'running'`);
    await submit("1", 2);
    const handed = await cancelKnowledgeCardPageRequest({ userId: "1", action: "knowledge_card_distill", requestId: uuid(1) });
    expect(handed).toMatchObject({ handedOff: true });
    expect((await row(first.id))?.input.cancelRequestedAt).toBeUndefined();
    await setRow(own("1", 2), `"updatedAt" = now() - interval '4 minutes'`);
    await cancelKnowledgeCardPageRequest({ userId: "1", action: "knowledge_card_distill", requestId: uuid(1) });
    expect((await row(first.id))?.input.cancelRequestedAt).toBeTruthy();
  });

  it("2b 原始页主动停止：即使有跟进页也停止；跟进页看到「任务已在另一页被停止」", async () => {
    const first = await submit("1", 1);
    await submit("1", 2);
    // queued 时主动停止：真实停止路径直接判失败
    const stopped = await cancelKnowledgeCardPageRequest({ userId: "1", action: "knowledge_card_distill", requestId: uuid(1), explicit: true });
    expect(stopped).toMatchObject({ status: "failed" });
    expect(await resolveKnowledgeCardFollowJob((await getJobByIdStrict(own("1", 2))) as any)).toMatchObject({ status: "failed", error: KNOWLEDGE_CARD_STOPPED_ELSEWHERE_MESSAGE });
  });

  it("2c 跨用户：别的账号停不了、跟不了、也挂不上本人的任务", async () => {
    const first = await submit("1", 1);
    await setRow(first.id, `status = 'running'`);
    await submit("1", 2);
    // 同一请求编号在别的账号下是另一条身份
    await cancelKnowledgeCardPageRequest({ userId: "2", action: "knowledge_card_distill", requestId: uuid(1), explicit: true });
    expect(await detachKnowledgeCardFollow({ userId: "2", jobId: own("1", 2) })).toBeNull();
    expect(await requestPlatformJobCancel({ jobId: first.id, userId: "2", actions: ["knowledge_card_distill"], queuedError: "x" })).toBeNull();
    expect((await row(first.id))?.input.cancelRequestedAt).toBeUndefined();
    expect((await row(own("1", 2)))?.status).toBe("following");
    // 伪造指向他人任务的跟进记录也读不到
    await pg.query(`INSERT INTO jobs (id, "userId", type, provider, status, input) VALUES ('forged', '2', 'platform', 'evolink', 'following', $1::json)`, [JSON.stringify({ action: KNOWLEDGE_CARD_FOLLOW_ACTION, attachedTo: first.id })]);
    expect(await resolveKnowledgeCardFollowJob((await getJobByIdStrict("forged")) as any)).toMatchObject({ status: "failed" });
    expect((await submit("2", 5)).attachedTo).toBeNull();
  });

  it("不同原稿或不同设置（身份键不同）都建新单", async () => {
    const a = await submit("1", 1);
    const c = await submit("1", 3, "K-other-source");
    const d = await submit("1", 4, "K-other-level", { ...params, detailLevel: "concise" });
    expect([a, c, d].map(x => x.attachedTo)).toEqual([null, null, null]);
    expect(await rows()).toHaveLength(3);
  });

  it.each(["succeeded", "failed"])("上一单已%s：不挡新提交", async status => {
    const a = await submit("1", 1);
    await setRow(a.id, `status = '${status}'`);
    expect(await submit("1", 2)).toEqual({ id: own("1", 2), attachedTo: null });
  });

  it("经真实停止路径请求停止（运行中、尚未收尾）：不挡新提交", async () => {
    const a = await submit("1", 1);
    await setRow(a.id, `status = 'running'`);
    const r = await cancelKnowledgeCardPageRequest({ userId: "1", action: "knowledge_card_distill", requestId: uuid(1), explicit: true });
    expect(r?.status).toBe("running");
    expect((await row(a.id))?.input.cancelRequestedAt).toBeTruthy();
    expect(await submit("1", 2)).toEqual({ id: own("1", 2), attachedTo: null });
  });

  it("运行中但心跳超过僵尸窗口（进程已崩）：允许新提交；窗口内仍跟进", async () => {
    const a = await submit("1", 1);
    await setRow(a.id, `status = 'running', "updatedAt" = now() - interval '19 minutes'`);
    expect((await submit("1", 2)).attachedTo).toBe(a.id);
    await setRow(a.id, `"updatedAt" = now() - interval '21 minutes', "createdAt" = now() - interval '2 hours'`);
    expect(await submit("1", 3)).toEqual({ id: own("1", 3), attachedTo: null });
  });

  it("久未领取的排队单同样不挡；同请求编号重试仍是原单、刷新占位不被复活", async () => {
    const a = await submit("1", 1);
    await setRow(a.id, `"createdAt" = now() - interval '30 minutes', "updatedAt" = now() - interval '30 minutes'`);
    const b = await submit("1", 2);
    expect(b.attachedTo).toBeNull();
    expect(await submit("1", 2)).toEqual({ id: b.id, attachedTo: null });
    await cancelKnowledgeCardPageRequest({ userId: "1", action: "knowledge_card_distill", requestId: uuid(9) });
    const late = await submit("1", 9);
    expect(late.attachedTo).toBeNull();
    expect((await row(late.id))?.status).toBe("failed");
  });

  it("没有可靠身份时不去重，沿用原建单", async () => {
    await submit("1", 1);
    expect((await submit("1", 2, null)).attachedTo).toBeNull();
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
