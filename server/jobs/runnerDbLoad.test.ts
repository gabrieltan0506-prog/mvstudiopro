/**
 * 1120 运行器数据库负载与心跳（L5）：
 * A 取消轮询只取所需列；B 进度写入库内 jsonb 合并、不先读整行，且与原「读改写」逐项等价；
 * C 提炼独立 30 秒心跳，心跳写库挂住后 20 秒放弃本次并恢复后续心跳。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: async () => state.db }));
vi.mock("../routers", () => ({ appRouter: {}, buildPlatformContent: vi.fn(), slimBuildPlatformContentDiagnosticsForJob: vi.fn() }));
import { isPlatformJobCancelRequested, patchJobRunningProgress } from "./repository";
import { startPlatformExecutionHeartbeat, withTimeout, WORKER_HEARTBEAT_WRITE_TIMEOUT_MS } from "./runner";

const pg = new PGlite();
const queries: string[] = [];
beforeAll(async () => {
  await pg.exec(`CREATE TABLE jobs (id varchar(64) PRIMARY KEY, "userId" varchar(64) NOT NULL, type text NOT NULL, provider varchar(64) NOT NULL,
    status text NOT NULL DEFAULT 'queued', input json NOT NULL, output json, error text, attempts integer NOT NULL DEFAULT 0,
    "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now());`);
}, 30_000);
beforeEach(async () => {
  queries.length = 0;
  state.db = drizzle(pg, { logger: { logQuery: (q: string) => { queries.push(q); } } });
  await pg.exec("TRUNCATE jobs");
});
afterAll(() => pg.close());

const insert = (id: string, status: string, input: unknown, output: unknown) =>
  pg.query(`INSERT INTO jobs (id, "userId", type, provider, status, input, output) VALUES ($1,'7','platform','evolink',$2,$3::json,$4::json)`,
    [id, status, JSON.stringify(input), output === undefined ? null : JSON.stringify(output)]);
const outputOf = async (id: string) => (await pg.query<any>(`SELECT output FROM jobs WHERE id=$1`, [id])).rows[0].output;
/** 原实现的合并语义（读整行 → 浅合并 → 日志截断 → JSON 序列化写回） */
const legacyMerge = (prev: unknown, patch: Record<string, unknown>) => {
  const base = prev && typeof prev === "object" && !Array.isArray(prev) ? { ...(prev as Record<string, unknown>) } : {};
  const next: Record<string, unknown> = { ...base, ...patch };
  if (Array.isArray(next.imageGenFlowLog)) next.imageGenFlowLog = (next.imageGenFlowLog as unknown[]).slice(-240);
  return JSON.parse(JSON.stringify(next));
};
const bigInput = { action: "knowledge_card_distill", params: { fullMarkdown: "底".repeat(200_000) } };

describe("A 取消轮询只取所需列", () => {
  it("SQL 不读 output、不把 input 整列取回；取消/失败/未取消/不存在判定与原来一致", async () => {
    await insert("a1", "running", bigInput, { big: "x" });
    await insert("a2", "running", { ...bigInput, cancelRequestedAt: "2026-11-20T00:00:00Z" }, null);
    await insert("a3", "failed", bigInput, null);
    await insert("a4", "running", "not-an-object", null);
    expect(await isPlatformJobCancelRequested("a1")).toBe(false);
    expect(await isPlatformJobCancelRequested("a2")).toBe(true);
    expect(await isPlatformJobCancelRequested("a3")).toBe(true);
    expect(await isPlatformJobCancelRequested("a4")).toBe(false);
    expect(await isPlatformJobCancelRequested("missing")).toBe(true);
    for (const q of queries) {
      expect(q).not.toMatch(/"output"/);
      expect(q).not.toMatch(/select "id", "userId"/);
      // input 只出现在取键表达式里，不作为整列返回
      expect(q.replace(/(?:"jobs"\.)?"input"->'(cancelRequestedAt|handedOffAt)'/g, "").replace(/json_typeof\((?:"jobs"\.)?"input"\)/g, "")).not.toMatch(/"input"/);
    }
  });
});

describe("B 进度写入库内合并", () => {
  it("一次 UPDATE 完成，不先 SELECT 整行", async () => {
    await insert("b1", "running", bigInput, { a: 1 });
    await patchJobRunningProgress("b1", { distillStage: "reading" });
    expect(queries.filter((q) => /^select/i.test(q))).toEqual([]);
    expect(queries.filter((q) => /^update/i.test(q))).toHaveLength(1);
    expect(await outputOf("b1")).toEqual({ a: 1, distillStage: "reading" });
  });

  it("与原读改写逐项等价：浅合并、嵌套整体替换、undefined 删键、非对象旧值、日志截断（补丁或旧值超限）", async () => {
    const longLog = Array.from({ length: 300 }, (_, i) => `步骤${i}`);
    const cases: Array<[unknown, Record<string, unknown>]> = [
      [null, { distillStage: "reading", distillPercent: 5 }],
      [{ a: 1, nested: { x: 1, y: 2 }, keep: [1, 2] }, { nested: { x: 9 }, b: "新" }],
      [{ distillFileName: "a.pdf", distillStage: "reading" }, { distillFileName: undefined, distillStage: "selecting" }],
      [[1, 2, 3], { a: 1 }],
      [42, { a: 1 }],
      [{ a: 1 }, { imageGenFlowLog: longLog }],
      [{ imageGenFlowLog: longLog, a: 1 }, { b: 2 }],
      [{ imageGenFlowLog: ["旧"] }, { imageGenFlowLog: [] }],
      [{ distillStageAt: { jobCreated: "t0" } }, { distillStageAt: { jobCreated: "t0", runnerStarted: "t1" }, n: null, z: 0, s: "" }],
    ];
    for (const [i, [prev, patch]] of Array.from(cases.entries())) {
      const id = `b-eq-${i}`;
      await insert(id, "running", { action: "x" }, prev);
      await patchJobRunningProgress(id, patch);
      expect(await outputOf(id), `case ${i}`).toEqual(legacyMerge(prev, patch));
    }
  });

  it("非 running、已有结算检查点不写（与原来一致）；历史字符串形态退回读改写", async () => {
    await insert("b-done", "succeeded", { action: "x" }, { a: 1 });
    await patchJobRunningProgress("b-done", { a: 2 });
    expect(await outputOf("b-done")).toEqual({ a: 1 });
    await insert("b-settle", "running", { action: "x" }, { knowledgeCardSettlement: { version: 1 } });
    await patchJobRunningProgress("b-settle", { a: 2 });
    expect(await outputOf("b-settle")).toEqual({ knowledgeCardSettlement: { version: 1 } });
    await insert("b-str", "running", { action: "x" }, JSON.stringify({ a: 1 }));
    await patchJobRunningProgress("b-str", { b: 2 });
    expect(await outputOf("b-str")).toEqual({ a: 1, b: 2 });
  });

  it("并发补丁不同键互不抹掉（行锁内合并）", async () => {
    await insert("b-race", "running", bigInput, {});
    await Promise.all([
      patchJobRunningProgress("b-race", { readingPreparation: { ready: [0] } }),
      patchJobRunningProgress("b-race", { distillStage: "reading" }),
      patchJobRunningProgress("b-race", { epubPdfs: ["a"] }),
    ]);
    expect(await outputOf("b-race")).toEqual({ readingPreparation: { ready: [0] }, distillStage: "reading", epubPdfs: ["a"] });
  });
});

describe("C 心跳", () => {
  it("提炼任务也有独立 30 秒心跳：单段 25 分钟无进度仍不判死", async () => {
    vi.useFakeTimers();
    const persist = vi.fn(async () => true);
    const stop = startPlatformExecutionHeartbeat({ id: "distill-hb", type: "platform", input: { action: "knowledge_card_distill", params: {} } },
      Number.MAX_SAFE_INTEGER, 20 * 60_000, persist);
    expect(stop).toBeTypeOf("function");
    try {
      const work = new Promise<string>((resolve) => setTimeout(() => resolve("成稿"), 25 * 60_000));
      const result = withTimeout(work, Number.MAX_SAFE_INTEGER, "超时", { heartbeat: { jobId: "distill-hb", stallMs: 20 * 60_000 } });
      await vi.advanceTimersByTimeAsync(25 * 60_000);
      await expect(result).resolves.toBe("成稿");
      expect(persist.mock.calls.length).toBeGreaterThanOrEqual(49);
    } finally { stop?.(); vi.useRealTimers(); }
  });

  it("写库挂住：20 秒后放弃本次，下一拍照常心跳；迟到结果不记账", async () => {
    vi.useFakeTimers();
    let call = 0;
    const persist = vi.fn(() => (++call === 1 ? new Promise<boolean>(() => {}) : Promise.resolve(true)));
    const stop = startPlatformExecutionHeartbeat({ id: "hang-hb", type: "platform", input: { action: "knowledge_card_distill" } },
      Number.MAX_SAFE_INTEGER, 20 * 60_000, persist);
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      expect(persist).toHaveBeenCalledTimes(1);
      expect(WORKER_HEARTBEAT_WRITE_TIMEOUT_MS).toBe(20_000);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(persist).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5 * 30_000);
      expect(persist).toHaveBeenCalledTimes(7);
    } finally { stop?.(); vi.useRealTimers(); }
  });

  it("其他任务类型行为不变：歌曲操作仍不起独立心跳", () => {
    expect(startPlatformExecutionHeartbeat({ id: "s", type: "audio", input: { action: "song_operation" } }, 1000, undefined, vi.fn())).toBeUndefined();
  });
});
