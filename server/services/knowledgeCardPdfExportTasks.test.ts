import { describe, expect, it } from "vitest";
import { createKnowledgeCardPdfTasks, knowledgeCardPdfTaskKey } from "./knowledgeCardPdfExportTasks";

const urls = ["https://storage.googleapis.com/b/generated/platform_knowledge_card/u1/a.png?X-Goog-Signature=1", "gs://b/generated/platform_knowledge_card/u1/b.png"];

describe("纯图片 PDF 后台任务", () => {
  it("发起即返回 running；进度随页推进；完成后给结果；同一批图（签名不同）复用同一任务", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let runs = 0;
    const tasks = createKnowledgeCardPdfTasks({
      run: async ({ imageUrls, onPage }) => {
        runs += 1;
        onPage(1);
        await gate;
        onPage(2);
        return { gcsUri: "gs://b/x.pdf", url: "https://example.test/x.pdf", pageCount: imageUrls.length };
      },
    });
    const first = tasks.start(1, urls, "t");
    expect(first.status).toBe("running");
    await Promise.resolve();
    expect(tasks.status(1, first.taskId)).toMatchObject({ status: "running", donePages: 1, totalPages: 2 });
    const resigned = [urls[0]!.replace("Signature=1", "Signature=2"), urls[1]!];
    expect(knowledgeCardPdfTaskKey(1, resigned)).toBe(first.taskId);
    expect(tasks.start(1, resigned).taskId).toBe(first.taskId);
    expect(tasks.hasRunning(1)).toBe(true);
    release();
    await tasks.settled(first.taskId);
    expect(tasks.status(1, first.taskId)).toMatchObject({ status: "succeeded", result: { pageCount: 2 } });
    expect(tasks.start(1, urls).status).toBe("succeeded");
    expect(runs).toBe(1);
    expect(tasks.hasRunning(1)).toBe(false);
  });

  it("失败给出不含地址的原因，且可重新发起；他人查不到任务", async () => {
    let fail = true;
    const tasks = createKnowledgeCardPdfTasks({
      run: async () => {
        if (fail) throw new Error("读取成品图失败（403） https://storage.googleapis.com/b/secret?sig=1");
        return { gcsUri: "gs://b/x.pdf", url: "u", pageCount: 2 };
      },
    });
    const first = tasks.start(1, urls);
    await tasks.settled(first.taskId);
    const failed = tasks.status(1, first.taskId)!;
    expect(failed.status).toBe("failed");
    expect(JSON.stringify(failed)).not.toContain("storage.googleapis.com");
    expect(tasks.status(2, first.taskId)).toBeNull();
    fail = false;
    expect(tasks.start(1, urls).status).toBe("running");
    await tasks.settled(first.taskId);
    expect(tasks.status(1, first.taskId)!.status).toBe("succeeded");
  });
});
