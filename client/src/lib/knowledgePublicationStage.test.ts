import { expect, it } from "vitest";
import { KNOWLEDGE_PREVIEW_RETRY_DELAYS_MS, knowledgeStageLabel, loadKnowledgePreviewWithRetry } from "./knowledgePublicationStage";

it("阶段文案显示当前步与完成数，不含模型或通道名", () => {
  expect(knowledgeStageLabel({ step: 0, done: 12, total: 34 })).toBe("【逐章整理 12/34】 → 统稿 → 整册排版 → 版面审查与 PDF");
  expect(knowledgeStageLabel({ step: 1, done: 1, total: 2 })).toBe("逐章整理 ✓ → 【统稿 1/2】 → 整册排版 → 版面审查与 PDF");
  expect(knowledgeStageLabel({ step: 3 })).toBe("逐章整理 ✓ → 统稿 ✓ → 整册排版 ✓ → 【版面审查与 PDF】");
  expect(knowledgeStageLabel({ step: 1 })).not.toContain("联网");
  expect(knowledgeStageLabel({ step: 4 })).toContain("全部完成");
  expect(knowledgeStageLabel(null)).toBe("");
});
it("整册预览读取失败按退避自动重试 3 次，成功即返回", async () => {
  const waits: number[] = [], retries: number[] = [];
  let calls = 0;
  const result = await loadKnowledgePreviewWithRetry(async () => { if (++calls < 3) throw Error("读取失败"); return "预览"; },
    { alive: () => true, sleep: async ms => { waits.push(ms); }, onRetry: n => retries.push(n) });
  expect(result).toEqual({ ok: true, value: "预览" });
  expect(waits).toEqual([2000, 5000]); expect(retries).toEqual([1, 2]);
});
it("最多重试 3 次后返回失败（交由前台显示预览暂时读不出，而不是任务失败）；离开即停止", async () => {
  let calls = 0;
  const failed = await loadKnowledgePreviewWithRetry(async () => { calls++; throw Error("x"); }, { alive: () => true, sleep: async () => undefined });
  expect(failed.ok).toBe(false); expect(calls).toBe(1 + KNOWLEDGE_PREVIEW_RETRY_DELAYS_MS.length);
  let here = true; calls = 0;
  const left = await loadKnowledgePreviewWithRetry(async () => { calls++; here = false; throw Error("x"); }, { alive: () => here, sleep: async () => undefined });
  expect(left.ok).toBe(false); expect(calls).toBe(1);
});
