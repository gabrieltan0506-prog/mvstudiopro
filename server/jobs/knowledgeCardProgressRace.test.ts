/**
 * 读档进度写入串行（2026-11-19 审查）：顾问原文写入改到后台后，onReadingSource 的进度写入与目录页进度并发；
 * patchJobRunningProgress 是「读整条 output → 合并 → 写回」，两条并发写入时后写的会抹掉先写的字段。
 * 真实 repository 跑在 PGlite 上，runner 经 runClaimedJob 实跑 knowledge_card_distill 接线。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
const state = vi.hoisted(() => ({ db: null as any, snapshot: undefined as any, id: "" }));
vi.mock("../db", () => ({ getDb: async () => state.db }));
vi.mock("../routers", () => ({ appRouter: {}, buildPlatformContent: vi.fn(), slimBuildPlatformContentDiagnosticsForJob: vi.fn() }));
vi.mock("../services/knowledgeReadingPreparation", () => ({
  createKnowledgeReadingPreparation: () => ({
    onSource: async () => {},
    onPlan: async () => {},
    onChunk: async () => {},
    progress: () => ({ jobId: state.id, documentId: "d", batches: 3, ready: [0, 1, 2] }),
    finish: async () => undefined,
  }),
}));
vi.mock("../services/knowledgeCardDistill.js", () => ({
  prepareKnowledgeCardCopy: async (opts: any) => {
    // 后台顾问原文写入与目录页进度同时到达
    await Promise.all([
      opts.onReadingSource("file-0:k", ["正文"]),
      opts.onExtractProgress({ stage: "reading", done: 12, total: 130, fileName: "a.pdf" }),
    ]);
    const { getJobByIdStrict } = await import("./repository");
    state.snapshot = (await getJobByIdStrict(state.id))?.output;
    throw new Error("测试到此为止");
  },
}));
import { runClaimedJob } from "./runner";

const pg = new PGlite();
beforeAll(async () => {
  await pg.exec(`CREATE TABLE jobs (id varchar(64) PRIMARY KEY, "userId" varchar(64) NOT NULL, type text NOT NULL, provider varchar(64) NOT NULL,
    status text NOT NULL DEFAULT 'queued', input json NOT NULL, output json, error text, attempts integer NOT NULL DEFAULT 0,
    "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now());`);
}, 30_000);
beforeEach(async () => {
  state.db = drizzle(pg);
  state.snapshot = undefined;
  await pg.exec("TRUNCATE jobs");
});
afterAll(() => pg.close());

describe("knowledge_card_distill 进度写入", () => {
  it("顾问原文进度与目录页进度并发写入：两个字段都留在 output 里", async () => {
    state.id = "kc_progress_race_1";
    const input = { action: "knowledge_card_distill", params: { sourceText: "x", files: [] } };
    await pg.query(`INSERT INTO jobs (id, "userId", type, provider, status, input, attempts) VALUES ($1, '7', 'platform', 'evolink', 'running', $2::json, 1)`, [state.id, JSON.stringify(input)]);
    const job = (await pg.query<any>(`SELECT * FROM jobs WHERE id = $1`, [state.id])).rows[0];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try { await runClaimedJob(job).catch(() => undefined); } finally { warn.mockRestore(); error.mockRestore(); }
    expect(state.snapshot).toBeTruthy();
    expect(state.snapshot.distillStage).toBe("reading");
    expect(state.snapshot.readingPreparation).toEqual({ jobId: state.id, documentId: "d", batches: 3, ready: [0, 1, 2] });
  }, 60_000);
});
