import { describe, it, expect } from "vitest";
import { knowledgeIllustrationRun, knowledgeIllustrationJobId, runKnowledgeIllustrationBatch, classifyKnowledgeIllustrationFailure, KnowledgeIllustrationBatchError, inspectKnowledgeIllustrationRetry } from "./knowledgeIllustrationRun";
import { knowledgeCardPageJobId } from "../../../server/jobs/knowledgeCardPageTask";
describe("同步图片等待与真实任务身份", () => {
  it("预分配图片ID与服务端实际reserve使用的ID完全相同", async () => {
    const requestId = "12345678-1234-4123-8123-123456789abc";
    expect(await knowledgeIllustrationJobId("7", requestId)).toBe(knowledgeCardPageJobId("7", "platform_composite_sheet_progress", requestId));
  });
  it("只在图片完成后解除对应批次等待，停止使未完成批次明确失败", async () => {
    const run = knowledgeIllustrationRun(["first", "last"]);
    let ready = false;
    const first = run.wait(["first"]).then(() => { ready = true; });
    await Promise.resolve(); expect(ready).toBe(false);
    run.done("first"); await first; expect(ready).toBe(true);
    run.stop(); await expect(run.wait(["last"])).rejects.toThrow("配图未全部完成");
    await expect(run.wait(["first"])).resolves.toBeUndefined();
  });
});

const deferred = () => {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe("图片并发批次收口", () => {
  it("单页明确失败不停批：其余页照常派发且每页只提交一次，慢成功按原ID回填；全部收妥后才报错并带真实计数", async () => {
    const gates = Array.from({ length: 5 }, deferred);
    const ids = ["failed-original", "slow-original", "third", "fourth", "fifth"];
    const run = knowledgeIllustrationRun(ids);
    const pageError = new Error("OpenAI generations HTTP 400: Your request was rejected by the safety system (moderation_blocked)");
    const submitted: string[] = [], saved: string[] = [];
    let locked = true;
    const pending = runKnowledgeIllustrationBatch({
      count: ids.length, concurrency: 2, active: () => true,
      execute: async index => { submitted.push(ids[index]); await gates[index].promise; saved.push(ids[index]); run.done(ids[index]); },
    }).finally(() => { run.stop(); locked = false; });
    const outcome = pending.then(() => undefined, error => error);
    expect(submitted).toEqual(ids.slice(0, 2));
    gates[0].reject(pageError);
    await new Promise(r => setTimeout(r, 0));
    expect(submitted).toEqual(ids.slice(0, 3)); // 失败页的工位继续领下一页
    gates[1].resolve(); gates[2].resolve(); gates[3].resolve();
    await new Promise(r => setTimeout(r, 0));
    expect(locked).toBe(true); // 第五页仍在途，不提前解锁
    gates[4].resolve();
    const error = await outcome;
    expect(error).toBeInstanceOf(KnowledgeIllustrationBatchError);
    expect(error.cause).toBe(pageError);
    expect(error.summary).toMatchObject({ total: 5, dispatched: 5, succeeded: 4, failed: 1, unknown: 0, notDispatched: 0, stoppedBy: null });
    expect(error.message).toContain("配图完成 4/5 页");
    expect(submitted).toEqual(ids); expect(new Set(submitted).size).toBe(5);
    expect(saved).toEqual(ids.slice(1));
    expect(locked).toBe(false);
    await expect(run.wait(ids.slice(1))).resolves.toBeUndefined();
    await expect(run.wait([ids[0]])).rejects.toThrow("配图未全部完成");
  });

  it("整批必败（鉴权/授权/额度/配置）首错即停领新页；在途收妥后才返回，后到错误不覆盖首个整批错误", async () => {
    const gates = Array.from({ length: 3 }, deferred);
    const ids = ["auth-failed", "slow", "later", "never-1", "never-2"];
    const submitted: string[] = [];
    let stopped = false;
    const fatal = new Error("OpenAI generations HTTP 401: Incorrect API key provided");
    const pending = runKnowledgeIllustrationBatch({
      count: ids.length, concurrency: 3, active: () => true,
      execute: async index => { submitted.push(ids[index]); await gates[index].promise; },
    }).finally(() => { stopped = true; });
    const outcome = pending.then(() => undefined, error => error);
    gates[0].reject(fatal);
    await new Promise(r => setTimeout(r, 0));
    expect(stopped).toBe(false); expect(submitted).toEqual(ids.slice(0, 3));
    gates[2].reject(new Error("后到的单页错误"));
    gates[1].resolve();
    const error = await outcome;
    expect(error).toBeInstanceOf(KnowledgeIllustrationBatchError);
    expect(error.cause).toBe(fatal);
    expect(error.summary).toMatchObject({ total: 5, dispatched: 3, succeeded: 1, failed: 2, notDispatched: 2, stoppedBy: "batch_fatal" });
    expect(error.message).toContain("2 页未提交");
    expect(submitted).toEqual(ids.slice(0, 3));
  });

  it("结果未知的页本批只派发一次、不停批，计入待核实；恢复时对账拒绝重买，只补明确失败且已退款的页", async () => {
    const calls: number[] = [];
    const unknown = Object.assign(new Error("图片提交或保存结果尚未确认，请恢复原任务核对"), { kind: "unknown" });
    const error = await runKnowledgeIllustrationBatch({ count: 4, concurrency: 2, active: () => true,
      execute: async index => { calls.push(index); if (index === 1) throw unknown; if (index === 2) throw new Error("生成服务未返回图片（imageUrl 为空）\n（积分已退回）"); },
    }).then(() => null, e => e);
    expect(calls.sort()).toEqual([0, 1, 2, 3]);
    expect(error.summary).toMatchObject({ succeeded: 2, failed: 1, unknown: 1, stoppedBy: null });
    expect(error.summary.failures.map((f: any) => [f.index, f.kind])).toEqual([[1, "unknown"], [2, "page"]]);
    expect(error.message).toContain("1 页结果待核实，不会自动重新购买");
    // 恢复：按服务端任务状态对账，仅可补买的页再派发。
    const jobs: Record<string, { status: string; output?: unknown }> = {
      p1: { status: "failed", output: { knowledgeImageRetry: { version: 1, reason: "pending" } } }, // 未知：上游结果/退款未确认
      p2: { status: "failed", output: { knowledgeImageRetry: { version: 1, reason: "refunded" } } },
    };
    const rebuy: string[] = [];
    for (const id of ["p1", "p2"]) {
      const url = await inspectKnowledgeIllustrationRetry(id, false, async jobId => jobs[jobId]!).catch(() => "held");
      if (url === null) rebuy.push(id);
    }
    expect(rebuy).toEqual(["p2"]);
  });

  it("全部成功才正常返回，计数如实", async () => {
    const summary = await runKnowledgeIllustrationBatch({ count: 3, concurrency: 2, active: () => true, execute: async () => {} });
    expect(summary).toMatchObject({ total: 3, succeeded: 3, failed: 0, unknown: 0, notDispatched: 0, stoppedBy: null });
  });

  it("正常四路重叠并由空闲原工位补位，每页只提交一次", async () => {
    const gates = Array.from({ length: 6 }, deferred), fifth = deferred();
    const calls: [number, number][] = [];
    let active = 0, peak = 0;
    const pending = runKnowledgeIllustrationBatch({ count: 6, concurrency: 4, active: () => true,
      execute: async (index, lane) => {
        calls.push([index, lane]); peak = Math.max(peak, ++active);
        if (index === 4) fifth.resolve();
        await gates[index].promise; active--;
      },
    });
    expect(calls).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
    gates[1].resolve(); await fifth.promise;
    expect(calls[4]).toEqual([4, 1]);
    gates.forEach(gate => gate.resolve()); await pending;
    expect(peak).toBe(4); expect(calls).toHaveLength(6);
    expect(new Set(calls.map(([index]) => index)).size).toBe(6);
  });

  it("用户停止只停新领取，原在途全部结束后才返回", async () => {
    const gates = [deferred(), deferred()];
    const calls: number[] = [], completed: number[] = [];
    let active = true, settled = false;
    const pending = runKnowledgeIllustrationBatch({ count: 4, concurrency: 2, active: () => active,
      execute: async index => { calls.push(index); await gates[index].promise; completed.push(index); },
    }).then(() => { settled = true; });
    active = false; gates[0].resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false); expect(calls).toEqual([0, 1]);
    gates[1].resolve(); await pending;
    expect(completed).toEqual([0, 1]); expect(calls).toEqual([0, 1]);
  });
});

describe("补图前核对原回执", () => {
  it("已成功只恢复URL，不允许因为丢回包重新购买", async () => {
    expect(await inspectKnowledgeIllustrationRetry("original", false, async () => ({ status: "succeeded", output: { compositeImageUrl: "https://test.invalid/original.png" } }))).toBe("https://test.invalid/original.png");
  });
  it("D4：输出带新增 compositeImageFacts 字段时照常恢复同一URL", async () => {
    expect(await inspectKnowledgeIllustrationRetry("original", false, async () => ({ status: "succeeded", output: { compositeImageUrl: "https://test.invalid/original.png", compositeImageFacts: { version: 1, sha256: "a".repeat(64), bytes: 9, mimeType: "image/png", width: 2, height: 3 } } }))).toBe("https://test.invalid/original.png");
  });
  it("在途、未知和已成功空结果均拒绝；明确失败才允许补图", async () => {
    await expect(inspectKnowledgeIllustrationRetry("original", false, async () => ({ status: "running" }))).rejects.toThrow("仍在执行");
    await expect(inspectKnowledgeIllustrationRetry("original", false, async () => { throw new Error("(404) Job not found"); })).rejects.toThrow("404");
    await expect(inspectKnowledgeIllustrationRetry("original", false, async () => ({ status: "succeeded", output: {} }))).rejects.toThrow("缺少图片");
    await expect(inspectKnowledgeIllustrationRetry("original", false, async () => ({ status: "failed", output: { knowledgeImageRetry: { version: 1, reason: "pending" } } }))).rejects.toThrow("退款尚未确认");
    await expect(inspectKnowledgeIllustrationRetry("original", false, async () => ({ status: "failed" }))).rejects.toThrow("退款尚未确认");
    expect(await inspectKnowledgeIllustrationRetry("original", false, async () => ({ status: "failed", output: { knowledgeImageRetry: { version: 1, reason: "refunded" } } }))).toBeNull();
    expect(await inspectKnowledgeIllustrationRetry("original", true, async () => { throw new Error("(404) Job not found"); })).toBeNull();
  });
});

describe("出图失败分类", () => {
  const fatal = [
    "OpenAI generations HTTP 401: Incorrect API key provided",
    "OpenAI edits HTTP 403: Project does not have access to model gpt-image-2.6-sunburst",
    "EvoLink task failed: model_not_found",
    "OpenAI generations HTTP 429: You exceeded your current quota, please check your plan and billing details",
    "Credits 不足，需要 30 点（当前可用：0）",
    "EvoLink 通道未配置",
    "页面已离开，已停止本次任务",
  ];
  const unknown = ["图片提交或保存结果尚未确认，请恢复原任务核对", "出图结果无法确认，供应商可能已建单：为避免重复扣费未退款，已转人工对账，请勿重试", "原配图仍在执行或结果待核实，请等待原任务"];
  const page = ["EvoLink task failed: content policy\n── log ──\n[GPT-IMAGE-2·OpenAI] 异常 · OpenAI generations HTTP 401: Incorrect API key（已回落另一通道）", "OpenAI generations HTTP 400: Your request was rejected by the safety system", "EvoLink task failed: content policy", "生成服务未返回图片（imageUrl 为空）", "OpenAI generations HTTP 500: server error", "The operation was aborted due to timeout"];
  it.each(fatal)("整批必败：%s", m => expect(classifyKnowledgeIllustrationFailure(new Error(m))).toBe("batch_fatal"));
  it.each(unknown)("结果未知：%s", m => expect(classifyKnowledgeIllustrationFailure(new Error(m))).toBe("unknown"));
  it.each(page)("单页失败：%s", m => expect(classifyKnowledgeIllustrationFailure(new Error(m))).toBe("page"));
  it("tRPC 鉴权/付费错误码与取消按整批处理；kind=unknown 按未知", () => {
    for (const code of ["UNAUTHORIZED", "FORBIDDEN", "PAYMENT_REQUIRED"]) expect(classifyKnowledgeIllustrationFailure(Object.assign(new Error("x"), { data: { code } }))).toBe("batch_fatal");
    expect(classifyKnowledgeIllustrationFailure(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe("batch_fatal");
    expect(classifyKnowledgeIllustrationFailure(Object.assign(new Error("x"), { kind: "unknown" }))).toBe("unknown");
  });
});
