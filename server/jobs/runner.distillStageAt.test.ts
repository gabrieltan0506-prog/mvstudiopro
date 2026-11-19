import { afterEach, beforeEach, expect, it, vi } from "vitest";
// 1119 F1：真实 worker 控制流里的分段计时。提炼服务被桩掉：只按顺序触发既有进度回调，然后中止（不进入结算/扣费）。
const state = vi.hoisted(() => ({ job: null as any, claim: vi.fn(), patch: vi.fn(), failed: vi.fn(), prepare: vi.fn() }));
vi.mock("./repository", async load => ({
  ...await load<Record<string, unknown>>(),
  claimNextQueuedJob: state.claim,
  getJobByIdStrict: vi.fn(async () => state.job),
  getJobById: vi.fn(async () => state.job),
  patchJobRunningProgress: state.patch,
  markJobFailed: state.failed,
  isPlatformJobCancelRequested: vi.fn(async () => false),
  touchJobHeartbeat: vi.fn(),
}));
vi.mock("../services/knowledgeCardDistill.js", async load => ({ ...await load<Record<string, unknown>>(), prepareKnowledgeCardCopy: state.prepare }));
vi.mock("../services/knowledgeReadingPreparation", () => ({ createKnowledgeReadingPreparation: () => ({ onSource: async () => {}, onPlan: async () => {}, onChunk: async () => {}, progress: () => ({}), finish: async () => ({}) }) }));
vi.mock("../services/knowledgeCardDistillActivity.js", async load => ({ ...await load<Record<string, unknown>>(), knowledgeCardDistillActivity: { run: (_touch: unknown, fn: () => unknown) => fn() } }));
import { processJobsOnce } from "./runner";
const stamps = () => state.patch.mock.calls.map(c => c[1].distillStageAt).filter(Boolean).at(-1) as Record<string, string> | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  state.job = { id: "kc_stage_test", userId: "7", type: "platform", status: "running", attempts: 1, createdAt: "2026-11-19T00:00:00.000Z",
    output: null, input: { action: "knowledge_card_distill", params: { sourceText: "正文", distillModel: "deepseek-v4.1-flash-1017" } } };
  state.claim.mockResolvedValueOnce(state.job).mockResolvedValue(null);
  state.patch.mockImplementation(async (_id: string, patch: any) => { state.job.output = { ...state.job.output, ...patch }; });
  state.failed.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());
it("按既有回调顺序记下各阶段时刻，只记首次；中途失败也保留已记的时刻", async () => {
  state.prepare.mockImplementation(async (o: any) => {
    await o.onExtractProgress({ stage: "reading", done: 1, total: 2 });
    await o.onExtractProgress({ stage: "reading", done: 2, total: 2 });
    await o.onExtractProgress({ stage: "selecting", done: 1, total: 3 });
    await o.onExtractProgress({ stage: "selecting", done: 3, total: 3 });
    await o.onProgress({ phase: "distilling", doneChunks: 0, totalChunks: 2 });
    await o.onProgress({ phase: "distilling", doneChunks: 1, totalChunks: 2 });
    throw new Error("注入：第 2 段前进程失败");
  });
  await processJobsOnce();
  const at = stamps()!;
  expect(at.jobCreated).toBe("2026-11-19T00:00:00.000Z");
  for (const k of ["runnerStarted", "textReady", "contactSheetsReady", "triageDone", "firstDistillRequest"]) expect(typeof at[k]).toBe("string");
  expect(at.lastDistillReport).toBeUndefined();
  expect(at.distillOutputReady).toBeUndefined();
  const order = ["runnerStarted", "textReady", "contactSheetsReady", "triageDone", "firstDistillRequest"].map(k => Date.parse(at[k]));
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // 失败不清掉已落盘的计时
  expect(state.job.output.distillStageAt.firstDistillRequest).toBe(at.firstDistillRequest);
});
it("续做沿用上次已记时刻（取最早），只补新阶段", async () => {
  state.job.output = { distillStageAt: { textReady: "2026-11-19T00:01:00.000Z", runnerStarted: "2026-11-19T00:00:30.000Z" } };
  state.prepare.mockImplementation(async (o: any) => {
    await o.onExtractProgress({ stage: "reading", done: 2, total: 2 });
    await o.onProgress({ phase: "distilling", doneChunks: 2, totalChunks: 2 });
    throw new Error("注入：停止");
  });
  await processJobsOnce();
  const at = stamps()!;
  expect(at.textReady).toBe("2026-11-19T00:01:00.000Z");
  expect(at.runnerStarted).toBe("2026-11-19T00:00:30.000Z");
  expect(typeof at.lastDistillReport).toBe("string");
});
