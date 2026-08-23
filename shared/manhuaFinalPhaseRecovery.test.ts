import { describe, expect, it } from "vitest";
import {
  phaseAfterLeavingClipDock,
  resolveFinalVideoUrlFromBlocks,
  resolveLatestFinalVideoUrlFromBlocks,
  shouldOpenClipDockForPhase,
} from "./manhuaFinalPhaseRecovery";
import { parseManhuaWorkflowPhase } from "./manhuaWriterSession";

describe("成片阶段刷新恢复", () => {
  it("刷新后 phase 仍是 final，坞必须自动打开 —— 否则是一块空白工作台", () => {
    // 模拟刷新：会话读回 final，坞开关不持久化、从 false 开始
    const restored = parseManhuaWorkflowPhase("final", true);
    expect(restored).toBe("final");
    expect(shouldOpenClipDockForPhase(restored)).toBe(true);
  });

  it("其它阶段不会误开坞", () => {
    for (const p of ["outline", "assets", "storyboard", "edit"]) {
      expect(shouldOpenClipDockForPhase(p)).toBe(false);
    }
  });

  it("离开坞时 final 收口为 edit，其它阶段原样不动", () => {
    expect(phaseAfterLeavingClipDock("final")).toBe("edit");
    expect(phaseAfterLeavingClipDock("storyboard")).toBe("storyboard");
    expect(phaseAfterLeavingClipDock("outline")).toBe("outline");
  });
});

describe("成片地址从画布节点恢复", () => {
  const done = (id: string, url: string) => ({ id, status: "done", outputUrl: url });

  it("已有 final-e01 节点时刷新后地址非空 —— 原来只存 state，刷新恒为 null", () => {
    expect(resolveFinalVideoUrlFromBlocks([done("final-e01", "https://x/1.mp4")], 1)).toBe(
      "https://x/1.mp4",
    );
  });

  it("严格按集号取，不同集互不串", () => {
    const blocks = [done("final-e01", "https://x/1.mp4"), done("final-e02", "https://x/2.mp4")];
    expect(resolveFinalVideoUrlFromBlocks(blocks, 1)).toBe("https://x/1.mp4");
    expect(resolveFinalVideoUrlFromBlocks(blocks, 2)).toBe("https://x/2.mp4");
  });

  it("当前集没有 final 节点时不借用其它集成片", () => {
    // 回落会让第 9 集被标成「已完成」并播放/下载第 2 集的视频
    const blocks = [done("final-e01", "https://x/1.mp4"), done("final-e02", "https://x/2.mp4")];
    expect(resolveFinalVideoUrlFromBlocks(blocks, 9)).toBeNull();
  });

  it("「库里最近一条成片」是另一个函数，不与当前集状态共用一个值", () => {
    const blocks = [done("final-e01", "https://x/1.mp4"), done("final-e02", "https://x/2.mp4")];
    expect(resolveLatestFinalVideoUrlFromBlocks(blocks)).toBe("https://x/2.mp4");
    expect(resolveLatestFinalVideoUrlFromBlocks([])).toBeNull();
  });

  it("未完成或空地址的节点不算数", () => {
    expect(
      resolveFinalVideoUrlFromBlocks(
        [
          { id: "final-e01", status: "running", outputUrl: "https://x/1.mp4" },
          { id: "final-e02", status: "done", outputUrl: "   " },
        ],
        1,
      ),
    ).toBeNull();
  });

  it("非成片节点不会被误认", () => {
    expect(
      resolveFinalVideoUrlFromBlocks([done("clip-e01-s03", "https://x/c.mp4")], 1),
    ).toBeNull();
  });
});
