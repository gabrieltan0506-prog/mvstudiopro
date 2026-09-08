import fs from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = ts.createSourceFile("runner.ts", fs.readFileSync(new URL("./runner.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const functionNames = new Set(["processKnowledgeCardReadingJobsOnce", "processJobsOnce", "processOneJob", "startJobWorker", "stopJobWorker"]);
const stateNames = new Set(["knowledgeReadingProcessing", "knowledgeReadingTimer", "processing", "timer", "workerStarted", "growthAnalyzeTimer", "manhuaLearnTimer", "pdfTimer", "postProdTimer"]);
const selected = source.statements.filter(node => {
  if (ts.isFunctionDeclaration(node)) return Boolean(node.name && functionNames.has(node.name.text));
  return ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && stateNames.has(declaration.name.text));
}).map(node => node.getText(source).replace(/^export\s+/, "")).join("\n");
const compiled = ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function harness() {
  const claimReading = vi.fn().mockResolvedValue(null);
  const claimMain = vi.fn().mockResolvedValue(null);
  const run = vi.fn().mockResolvedValue(undefined);
  const intervals: Array<{ callback: () => void; handle: { unref: ReturnType<typeof vi.fn> } }> = [];
  const clearInterval = vi.fn();
  const worker = new Function("dependencies", `
    const { claimNextKnowledgeCardReadingJob, claimNextQueuedJob, runClaimedJob, setInterval, clearInterval, console } = dependencies;
    const processPdfJobsOnce = async () => {};
    const processPostProdJobsOnce = async () => {};
    const processGrowthAnalyzeJobsOnce = async () => {};
    const processManhuaLearnJobsOnce = async () => {};
    ${compiled}
    return { processKnowledgeCardReadingJobsOnce, processJobsOnce, startJobWorker, stopJobWorker };
  `)({
    claimNextKnowledgeCardReadingJob: claimReading, claimNextQueuedJob: claimMain, runClaimedJob: run,
    setInterval: (callback: () => void) => { const handle = { unref: vi.fn() }; intervals.push({ callback, handle }); return handle; },
    clearInterval, console: { error: vi.fn() },
  }) as { processKnowledgeCardReadingJobsOnce: () => Promise<void>; processJobsOnce: () => Promise<void>; startJobWorker: () => void; stopJobWorker: () => void };
  return { worker, claimReading, claimMain, run, intervals, clearInterval };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
describe("阅读worker独立单并发槽", () => {
  it("数据库领取未返回时已占槽，连续tick不会超量领取", async () => {
    const h = harness(); const pending = deferred<null>(); h.claimReading.mockReturnValueOnce(pending.promise);
    const active = h.worker.processKnowledgeCardReadingJobsOnce();
    await Promise.all([h.worker.processKnowledgeCardReadingJobsOnce(), h.worker.processKnowledgeCardReadingJobsOnce()]);
    expect(h.claimReading).toHaveBeenCalledTimes(1);
    pending.resolve(null); await active;
    await h.worker.processKnowledgeCardReadingJobsOnce(); expect(h.claimReading).toHaveBeenCalledTimes(2);
  });
  it("阅读长任务运行时普通任务照常执行，reading与edition仍串行", async () => {
    const h = harness(); const pending = deferred<void>();
    const reading = { id: "reading" }; const edition = { id: "edition" }; const normal = { id: "normal-image" };
    h.claimReading.mockResolvedValueOnce(reading).mockResolvedValueOnce(edition);
    h.claimMain.mockResolvedValueOnce(normal);
    h.run.mockImplementation(async job => { if (job.id === "reading") await pending.promise; });
    const active = h.worker.processKnowledgeCardReadingJobsOnce();
    await Promise.resolve(); await h.worker.processJobsOnce();
    expect(h.run.mock.calls.map(([job]) => job.id)).toEqual(["reading", "normal-image"]);
    expect(h.claimReading).toHaveBeenCalledTimes(1);
    await h.worker.processKnowledgeCardReadingJobsOnce(); expect(h.claimReading).toHaveBeenCalledTimes(1);
    pending.resolve(); await active;
    expect(h.run.mock.calls.map(([job]) => job.id)).toEqual(["reading", "normal-image", "edition"]);
  });
  it("领取或执行异常后释放阅读槽，不改变主槽状态", async () => {
    const h = harness(); h.claimReading.mockRejectedValueOnce(new Error("测试领取失败"));
    await expect(h.worker.processKnowledgeCardReadingJobsOnce()).rejects.toThrow("测试领取失败");
    h.claimReading.mockResolvedValueOnce({ id: "reading" }); h.run.mockRejectedValueOnce(new Error("测试运行失败"));
    await expect(h.worker.processKnowledgeCardReadingJobsOnce()).rejects.toThrow("测试运行失败");
    await h.worker.processKnowledgeCardReadingJobsOnce(); expect(h.claimReading).toHaveBeenCalledTimes(3);
    await h.worker.processJobsOnce(); expect(h.claimMain).toHaveBeenCalledTimes(1);
  });
  it("启动和定时tick接通阅读池，停止清除其timer，重复启动不增池", async () => {
    const h = harness(); h.worker.startJobWorker(); h.worker.startJobWorker();
    await Promise.resolve();
    expect(h.claimReading).toHaveBeenCalledTimes(1);
    const readingTimer = h.intervals.find(item => item.callback.toString().includes("processKnowledgeCardReadingJobsOnce"));
    expect(readingTimer).toBeDefined(); expect(readingTimer!.handle.unref).toHaveBeenCalledTimes(1);
    readingTimer!.callback(); await Promise.resolve(); expect(h.claimReading).toHaveBeenCalledTimes(2);
    h.worker.stopJobWorker(); expect(h.clearInterval).toHaveBeenCalledWith(readingTimer!.handle);
  });
});
