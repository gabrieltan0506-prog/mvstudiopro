import { describe, it, expect } from "vitest";
import { knowledgeIllustrationRun, knowledgeIllustrationJobId, runKnowledgeIllustrationBatch } from "./knowledgeIllustrationRun";
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
  it("首错停新领页，慢成功仍按原ID回填且解除正文等待，全部收妥才停止缺图并解锁", async () => {
    const gates = Array.from({ length: 4 }, deferred);
    const ids = ["failed-original", "slow-original", "later-failure", "fourth-original", "unsubmitted"];
    const run = knowledgeIllustrationRun(ids);
    const firstError = new Error("首张明确失败");
    const submitted: string[] = [], saved: string[] = [];
    let locked = true, stopped = false, successConsumed = false;
    const reading = run.wait([ids[1]]).then(() => { successConsumed = true; });
    const pending = runKnowledgeIllustrationBatch({
      count: ids.length, concurrency: 4, active: () => true,
      execute: async index => {
        submitted.push(ids[index]);
        await gates[index].promise;
        saved.push(ids[index]);
        run.done(ids[index]);
      },
    }).finally(() => { stopped = true; run.stop(); locked = false; });
    const outcome = pending.then(() => undefined, error => error);
    expect(submitted).toEqual(ids.slice(0, 4));
    gates[0].reject(firstError);
    await Promise.resolve(); await Promise.resolve();
    expect(locked).toBe(true); expect(stopped).toBe(false);
    expect(submitted).not.toContain(ids[4]);
    gates[1].resolve(); await reading;
    expect(successConsumed).toBe(true);
    expect(saved).toEqual([ids[1]]);
    expect(locked).toBe(true); expect(stopped).toBe(false);
    gates[2].reject(new Error("后到错误不得覆盖首错"));
    gates[3].resolve();
    expect(await outcome).toBe(firstError);
    expect(saved).toEqual([ids[1], ids[3]]);
    expect(locked).toBe(false); expect(stopped).toBe(true);
    expect(submitted).toEqual(ids.slice(0, 4));
    await expect(run.wait([ids[1], ids[3]])).resolves.toBeUndefined();
    await expect(run.wait([ids[0]])).rejects.toThrow("配图未全部完成");
    await expect(run.wait([ids[4]])).rejects.toThrow("配图未全部完成");
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

import { inspectKnowledgeIllustrationRetry } from "./knowledgeIllustrationRun";
describe("补图前核对原回执", () => {
  it("已成功只恢复URL，不允许因为丢回包重新购买", async () => {
    expect(await inspectKnowledgeIllustrationRetry("original", false, async () => ({ status: "succeeded", output: { compositeImageUrl: "https://test.invalid/original.png" } }))).toBe("https://test.invalid/original.png");
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
