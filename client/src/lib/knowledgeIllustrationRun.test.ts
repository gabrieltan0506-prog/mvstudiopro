import { describe, it, expect } from "vitest";
import { knowledgeIllustrationRun, knowledgeIllustrationJobId } from "./knowledgeIllustrationRun";
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
