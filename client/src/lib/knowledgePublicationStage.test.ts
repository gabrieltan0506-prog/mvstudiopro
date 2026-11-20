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

import { knowledgeStageEstimatedFraction, knowledgeStageProgress as stageProgress } from "./knowledgePublicationStage";
import { knowledgeHandbookOverallProgress as overall } from "./knowledgeHandbookOverallProgress";
it("没有计数的步按已用时持续前进、标为估算，且不会自己走到下一步", () => {
  // 统稿（第 2 步，起点 60，权重 15）：0 秒在起点，之后单调上升，再久也到不了 75。
  expect(stageProgress({ step: 1 })?.percent).toBe(60);
  expect(stageProgress({ step: 1 }, 0)?.estimated).toBeUndefined();
  const at = (ms: number) => stageProgress({ step: 1 }, ms)!;
  expect(at(60_000).percent).toBeGreaterThan(60);
  expect(at(240_000).percent).toBeGreaterThan(at(60_000).percent);
  expect(at(24 * 3600_000).percent).toBeLessThan(75);
  expect(at(60_000).estimated).toBe(true);
  expect(knowledgeStageEstimatedFraction(1, 1e12)).toBeLessThanOrEqual(0.9);
});
it("有计数的步只按实际完成数走，不受已用时影响", () => {
  expect(stageProgress({ step: 2, done: 3, total: 12 }, 600_000)).toMatchObject({ percent: 78, stepDone: 3, stepCount: 12 });
  expect(stageProgress({ step: 2, done: 3, total: 12 }, 600_000)?.estimated).toBeUndefined();
});
it("总体进度条同样随已用时前进；出错时停在实际位置", () => {
  const base = { status: "succeeded" as const, percent: 100 };
  const still = overall({ base, decision: "layout", stage: { step: 1 } }).percent;
  const moving = overall({ base, decision: "layout", stage: { step: 1 }, stageElapsedMs: 240_000 }).percent;
  expect(moving).toBeGreaterThan(still);
  expect(overall({ base, decision: "layout", stage: { step: 1 }, stageElapsedMs: 240_000, layoutError: "停了" }).percent).toBe(still);
});
