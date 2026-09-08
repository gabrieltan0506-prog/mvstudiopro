import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KNOWLEDGE_CARD_ACTIVE_DISTILL_MODELS } from "../../shared/knowledgeCardDistillModels";
import { knowledgeCardReadingConstraintsSchema, KNOWLEDGE_CARD_READING_MODES } from "../../shared/knowledgeCardReadingPlan";

// 从真实runner提取执行分支，只替换外部网络/服务/数据库边界。
const sourceText = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
const source = ts.createSourceFile("runner.ts", sourceText, ts.ScriptTarget.Latest, true);
let branch = "";
let timeoutBranch = "";
let dispositionFunction = "";
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(source) === 'input.action === "knowledge_card_reading" || input.action === "knowledge_card_edition"') {
    if (node.thenStatement.getText(source).includes("analyzeKnowledgeCardDocuments")) branch = node.thenStatement.getText(source);
    else if (node.thenStatement.getText(source).includes("KNOWLEDGE_CARD_READING_JOB_TIMEOUT_MS")) timeoutBranch = node.thenStatement.getText(source);
  }
  if (ts.isFunctionDeclaration(node) && node.name?.text === "resolveFailedJobDisposition") dispositionFunction = node.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
if (!branch || !timeoutBranch || !dispositionFunction) throw new Error("缺少真实阅读worker或超时/重排分支");
const compile = (text: string) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/\bimport\(/g, "importModule(");
const code = compile(`async function run(input, jobUserId, platformJobId, signal) { const params=input.params; ${branch} }`);
const input = () => ({ action: "knowledge_card_reading", params: {
  userId: 999, model: "gpt-5.6-sol", files: [{ gcsUri: "gs://test-bucket/uploads/u7/book.pdf", generation: "12345", mimeType: "application/pdf", fileName: "原书.pdf" }],
  constraints: { targetPages: 4, budgetCredits: 120 },
} });
function fixture(analyze = vi.fn(async (_input: unknown, progress: (done: number, total: number, phase: string) => Promise<void>, _signal?: AbortSignal) => {
  await progress(4, 275, "reading:1/1");
  return { analysisId: "analysis", planId: "plan", plan: { allPages: Array.from({ length: 275 }, (_, i) => i + 1) }, quote: { credits: 120 }, constraints: { targetPages: 4 }, sourcePages: 275 };
})) {
  const patch = vi.fn(async (_jobId: string, _progress: Record<string, unknown>) => undefined);
  const fee = vi.fn(async (_input: unknown) => 50);
  const unexpected = vi.fn(async (name: string) => { throw new Error(`禁止调用未授权边界：${name}`); });
  const importModule = async (name: string) => {
    if (name === "zod") return { z };
    if (name === "../../shared/knowledgeCardDistillModels.js") return { KNOWLEDGE_CARD_ACTIVE_DISTILL_MODELS };
    if (name === "../../shared/knowledgeCardReadingPlan.js") return { knowledgeCardReadingConstraintsSchema, KNOWLEDGE_CARD_READING_MODES };
    if (name === "../services/knowledgeCardReading.js") return { analyzeKnowledgeCardDocuments: analyze };
    if (name === "../services/knowledgeCardReadingFee.js") return { settleKnowledgeCardReadingFee: fee };
    return unexpected(name);
  };
  const run = new Function("importModule", "patchJobRunningProgressStrict", `${code}\nreturn run;`)(importModule, patch);
  return { run, patch, analyze, unexpected, fee };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("全页阅读平台任务真实分支", () => {
  it("心跳和重复回调不伪造内容进展，真实推进及终态带ISO时间", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T05:00:00Z"));
    let report!: (done: number, total: number, phase: string) => Promise<void>;
    let finish!: (value: any) => void;
    const { run, patch } = fixture(vi.fn(async (_input: unknown, progress: typeof report) => {
      report = progress;
      return await new Promise<any>(resolve => { finish = resolve; });
    }));
    const running = run(input(), "7", "job");
    await vi.advanceTimersByTimeAsync(30_000);
    const heartbeat = patch.mock.calls.at(-1)![1];
    expect(heartbeat).toMatchObject({ readingDonePages: 0, readingProgressUpdatedAt: "2026-09-08T05:00:00.000Z", readingHeartbeatAt: "2026-09-08T05:00:30.000Z" });
    await report(1, 275, "reading:1/1");
    await vi.advanceTimersByTimeAsync(10_000);
    await report(1, 275, "reading:1/1");
    expect(patch.mock.calls.at(-1)![1]).toMatchObject({ readingProgressUpdatedAt: "2026-09-08T05:00:30.000Z", readingHeartbeatAt: "2026-09-08T05:00:40.000Z" });
    await report(2, 275, "reading:1/1");
    expect(patch.mock.calls.at(-1)![1].readingProgressUpdatedAt).toBe("2026-09-08T05:00:40.000Z");
    finish({ sourcePages: 275 });
    const output = (await running).output;
    expect(output).toMatchObject({ readingPhase: "done", readingProgressUpdatedAt: "2026-09-08T05:00:40.000Z", readingHeartbeatAt: "2026-09-08T05:00:40.000Z" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([undefined, false, true])("只有明确chargeDistillFee=%s才调用原主动提炼费，读取失败不扣费", async chargeDistillFee => {
    const { run, fee } = fixture();
    const out = await run({ ...input(), params: { ...input().params, chargeDistillFee } }, "7", "reading-job");
    expect(out.output.distillFeeCharged).toBe(chargeDistillFee === true ? 50 : 0);
    expect(fee).toHaveBeenCalledTimes(chargeDistillFee === true ? 1 : 0);
    if (chargeDistillFee === true) expect(fee).toHaveBeenCalledWith({ userId: 7, analysisId: "analysis", model: "gpt-5.6-sol", chargeDistillFee: true });
    const failed = fixture(vi.fn(async () => { throw new Error("阅读失败"); }));
    await expect(failed.run({ ...input(), params: { ...input().params, chargeDistillFee } }, "7", "reading-job")).rejects.toThrow("阅读失败");
    expect(failed.fee).not.toHaveBeenCalled();
  });
  it("只信jobs归属，完整返回服务结果和原页总量，不新增收费边界", async () => {
    const { run, patch, analyze, unexpected } = fixture();
    const value = input();
    const snapshot = JSON.stringify(value);
    const signal = new AbortController().signal;
    const out = await run(value, "7", "reading-job", signal);
    expect(analyze.mock.calls[0]![0]).toEqual({ ...value.params, userId: 7 });
    expect(analyze.mock.calls[0]![2]).toBeInstanceOf(AbortSignal);
    expect(out).toMatchObject({ provider: "evolink", output: { success: true, analysisId: "analysis", planId: "plan", sourcePages: 275, quote: { credits: 120 }, constraints: { targetPages: 4 }, readingPhase: "done", readingProgressUpdatedAt: expect.any(String), readingHeartbeatAt: expect.any(String) } });
    expect(out.output.plan.allPages).toHaveLength(275);
    expect(patch).toHaveBeenCalledWith("reading-job", { readingDonePages: 4, readingTotalPages: 275, readingPhase: "reading:1/1", readingProgressUpdatedAt: expect.any(String), readingHeartbeatAt: expect.any(String) });
    expect(unexpected).not.toHaveBeenCalled();
    expect(JSON.stringify(value)).toBe(snapshot);
  });
  it.each([undefined, "0", "-1", "public", "1.2"])("无可信账号%s时在服务之前拒绝", async userId => {
    const { run, analyze, patch } = fixture();
    await expect(run(input(), userId, "job")).rejects.toThrow("可信");
    expect(analyze).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
  it("缺少任务ID、退休模型和无版本原件不能开始读取", async () => {
    const { run, analyze } = fixture();
    await expect(run(input(), "7", undefined)).rejects.toThrow();
    await expect(run({ ...input(), params: { ...input().params, model: "claude-opus-5" } }, "7", "job")).rejects.toThrow();
    const missingVersion = input();
    missingVersion.params.files[0]!.generation = "";
    await expect(run(missingVersion, "7", "job")).rejects.toThrow();
    expect(analyze).not.toHaveBeenCalled();
  });
  it("失败保留输入和最新进度，不假报成功、不清理证据且停止心跳", async () => {
    vi.useFakeTimers();
    const failure = new Error("已有请求等待对账，未重复购买");
    const analyze = vi.fn(async (_input: unknown, progress: (done: number, total: number, phase: string) => Promise<void>) => {
      await progress(272, 275, "reading:1/1");
      throw failure;
    });
    const { run, patch, unexpected } = fixture(analyze);
    const value = input();
    const original = JSON.stringify(value);
    await expect(run(value, "7", "job")).rejects.toBe(failure);
    expect(patch.mock.calls.at(-1)).toEqual(["job", { readingDonePages: 272, readingTotalPages: 275, readingPhase: "reading:1/1", readingProgressUpdatedAt: expect.any(String), readingHeartbeatAt: expect.any(String) }]);
    expect(JSON.stringify(value)).toBe(original);
    expect(vi.getTimerCount()).toBe(0);
    expect(unexpected).not.toHaveBeenCalled();
  });
  it("长批次保持活动心跳，中止后不继续更新或交付晚到结果", async () => {
    vi.useFakeTimers();
    let finish!: (result: any) => void;
    const analyze = vi.fn(async () => await new Promise<any>(resolve => { finish = resolve; }));
    const { run, patch } = fixture(analyze);
    const controller = new AbortController();
    const running = run(input(), "7", "job", controller.signal);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(patch.mock.calls.length).toBeGreaterThanOrEqual(3);
    controller.abort(new Error("外层任务超时"));
    const count = patch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(patch).toHaveBeenCalledTimes(count);
    const rejected = expect(running).rejects.toThrow("外层任务超时");
    finish({ planId: "late" });
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("已中止任务不进入外部读取服务", async () => {
    const { run, analyze } = fixture();
    const controller = new AbortController();
    controller.abort(new Error("已停止"));
    await expect(run(input(), "7", "job", controller.signal)).rejects.toThrow("已停止");
    expect(analyze).not.toHaveBeenCalled();
  });
  it("心跳发现任务终止或数据库不可写时，立刻中止服务且不继续购买后批", async () => {
    vi.useFakeTimers();
    const analyze = vi.fn(async (_input: unknown, _progress: unknown, signal?: AbortSignal) => await new Promise<any>((_resolve, reject) => {
      signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
    }));
    const { run, patch } = fixture(analyze);
    patch.mockResolvedValueOnce(undefined).mockRejectedValue(new Error("Job no longer running"));
    const running = run(input(), "7", "job");
    const rejected = expect(running).rejects.toThrow("no longer running");
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("阅读任务墙钟及失败策略", () => {
  const disposition = new Function("isRecord", "paidImageLedgerTaskType", `${compile(dispositionFunction.replace(/^export\s+/, ""))}\nreturn resolveFailedJobDisposition;`)(
    (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value), () => null,
  );
  const timeout = new Function(`${compile(`function timeout() ${timeoutBranch}`)}\nreturn timeout;`)();
  it("阅读任何失败均不自动重排，旧动作继续原两次策略", () => {
    for (const action of ["knowledge_card_reading", "knowledge_card_edition"])
      for (const attempts of [0, 1, 2]) expect(disposition({ type: "platform", input: { ...input(), action }, attempts })).toBe("fail");
    expect(disposition({ type: "platform", input: { action: "knowledge_card_distill" }, attempts: 1 })).toBe("requeue");
    expect(disposition({ type: "platform", input: { action: "knowledge_card_distill" }, attempts: 2 })).toBe("fail");
    expect(sourceText).toContain('else if (resolveFailedJobDisposition(job) === "requeue")');
  });
  it("有专用长墙钟，环境显式覆盖而非沿用8分钟；底层接到超时AbortSignal", () => {
    vi.stubEnv("KNOWLEDGE_CARD_READING_JOB_TIMEOUT_MS", "");
    expect(timeout()).toBe(6 * 60 * 60_000);
    vi.stubEnv("KNOWLEDGE_CARD_READING_JOB_TIMEOUT_MS", "300000");
    expect(timeout()).toBe(300_000);
    expect(sourceText).toContain("job.id, readingController?.signal");
    expect(sourceText).toContain("onTimeout: () => readingController.abort");
  });
});
