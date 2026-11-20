import { describe, expect, it } from "vitest";
import { knowledgeHandbookOverallProgress, KNOWLEDGE_IMAGES_DONE_PERCENT } from "./knowledgeHandbookOverallProgress";
import { knowledgeStageProgress, KNOWLEDGE_PUBLICATION_STAGES } from "./knowledgePublicationStage";

const done = { status: "succeeded" as const, percent: 100, label: "出图 48/48 页" };

describe("手册总体进度：只要图片 100%，要排版则接着显示排版进度", () => {
  it("出图未收口时原样显示；不涉及排版选择时原样显示", () => {
    const running = { status: "running" as const, percent: 80, label: "出图 24/48 页" };
    expect(knowledgeHandbookOverallProgress({ base: running, decision: "pending", stage: null })).toBe(running);
    expect(knowledgeHandbookOverallProgress({ base: done, decision: "not_applicable", stage: null })).toBe(done);
  });
  it("图片出完未选择：不提前显示 100%", () => {
    const shown = knowledgeHandbookOverallProgress({ base: done, decision: "pending", stage: null });
    expect(shown.status).toBe("running");
    expect(shown.percent).toBe(KNOWLEDGE_IMAGES_DONE_PERCENT);
    expect(shown.label).toContain("等待选择");
  });
  it("只要图片：100% 完成", () => {
    expect(knowledgeHandbookOverallProgress({ base: done, decision: "images_only", stage: null })).toMatchObject({ status: "succeeded", percent: 100 });
  });
  it("要排版：四步依次推进，进度只增不减，全部完成才 100%", () => {
    const stages = [null, { step: 0, done: 0, total: 48 }, { step: 0, done: 17, total: 48 }, { step: 0, done: 48, total: 48 }, { step: 1 }, { step: 1, done: 2, total: 4 }, { step: 2 }, { step: 3 }, { step: KNOWLEDGE_PUBLICATION_STAGES.length }];
    let last = KNOWLEDGE_IMAGES_DONE_PERCENT;
    stages.forEach((stage, i) => {
      const shown = knowledgeHandbookOverallProgress({ base: done, decision: "layout", stage });
      expect(shown.percent, `第${i}个阶段`).toBeGreaterThanOrEqual(last);
      last = shown.percent;
      expect(shown.status).toBe(i === stages.length - 1 ? "succeeded" : "running");
      if (i < stages.length - 1) expect(shown.percent).toBeLessThan(100);
    });
    expect(last).toBe(100);
    const mid = knowledgeHandbookOverallProgress({ base: done, decision: "layout", stage: { step: 0, done: 17, total: 48 } });
    expect(mid).toMatchObject({ stepNumber: 1, stepTotal: 4, stageDone: 17, stageTotal: 48 });
    expect(mid.label).toContain("逐章整理");
  });
  it("排版失败或暂停：保留当前位置并带出错误说明", () => {
    expect(knowledgeHandbookOverallProgress({ base: done, decision: "layout", stage: { step: 2 }, layoutError: "整理已暂停" })).toMatchObject({ status: "failed", error: "整理已暂停" });
    expect(knowledgeHandbookOverallProgress({ base: done, decision: "layout", stage: { step: 2 }, layoutError: "已停止", layoutStopped: true }).status).toBe("stopped");
  });
  it("排版四步总进度：步内线性，未完成不到 100", () => {
    expect(knowledgeStageProgress(null)).toBeNull();
    expect(knowledgeStageProgress({ step: 0, done: 24, total: 48 })).toMatchObject({ percent: 30, stepNumber: 1, stepDone: 24, stepCount: 48, finished: false });
    expect(knowledgeStageProgress({ step: 3 })).toMatchObject({ percent: 85, stepNumber: 4, finished: false });
    expect(knowledgeStageProgress({ step: 4 })).toMatchObject({ percent: 100, finished: true });
  });
});
