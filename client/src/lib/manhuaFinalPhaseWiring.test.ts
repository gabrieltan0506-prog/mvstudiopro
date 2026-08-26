/**
 * 「成片」阶段接线的源码契约测试。
 *
 * 终审要求的是组件级恢复测试（落盘 → 刷新 → 坞可见 → 返回 → edit）。
 * OmniCanvas.tsx 近万行，挂 render 测试要先解决大量 mock，本轮做不扎实。
 *
 * 但真正会复发的不是判据算错——判据已有 7 条函数级回归
 * （shared/manhuaFinalPhaseRecovery.test.ts）——而是
 * **有人加了第六个离开坞的出口、忘了把 phase 一起收回来**。
 * 那正是这次 P0-1 的成因。这类回归靠源码契约拦得比 render 测试更直接。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  new URL("../pages/OmniCanvas.tsx", import.meta.url),
  "utf8",
);
const WORKBENCH_SRC = readFileSync(
  new URL("../components/ManhuaScriptWorkbench.tsx", import.meta.url),
  "utf8",
);

describe("成片阶段接线契约", () => {
  it("成片地址必须从画布节点派生，不能退回 React state", () => {
    // 退回 useState 就等于刷新后恒为 null，已合成的成片被判成未完成
    expect(SRC).toContain("resolveFinalVideoUrlFromBlocks(blocks, writerFocusEpisode)");
    expect(SRC).not.toContain("setFinalAssembleVideoUrl");
  });

  it("进 final 必须自动开坞 —— 第五格的面板就是坞", () => {
    expect(SRC).toContain("shouldOpenClipDockForPhase(workflowPhase)");
  });

  it("返回工作台时只把 final 收回 edit，并切回工作台", () => {
    const at = SRC.indexOf("const closeClipDockToWorkbench");
    expect(at).toBeGreaterThan(0);
    const fn = SRC.slice(at, at + 380);
    expect(fn).toContain("phaseAfterLeavingClipDock(current)");
    expect(fn).toContain('setImmersiveWorkspaceView("workbench")');
  });

  it("每一处直接切回工作台都必须自己把 phase 带走 —— 否则就是一个空白工作台入口", () => {
    /**
     * 这是本条的核心不变式，不依赖「我记得有几处、分别在哪」：
     * 只要关了坞而 phase 还停在 final，用户看到的就是空白工作台。
     * 第一次跑这条时抓到两处漏网出口（第三个「切经典表单」等），
     * 正是它存在的理由。
     */
    const sites: number[] = [];
    const re = /setImmersiveWorkspaceView\("workbench"\)/g;
    for (let m = re.exec(SRC); m; m = re.exec(SRC)) sites.push(m.index);
    expect(sites.length).toBeGreaterThan(0);

    const offenders = sites.filter((at) => {
      const around = SRC.slice(Math.max(0, at - 700), at + 700);
      return !/setWorkflowPhase\(/.test(around);
    });
    expect(offenders).toEqual([]);
  });

  it("换集必须显式带走 phase —— 新集大概率还没合成", () => {
    const match = /onSelectEpisode=\{(?:\(ep\)|ep) =>/.exec(SRC);
    const at = match?.index ?? -1;
    expect(at).toBeGreaterThan(0);
    const block = SRC.slice(at, at + 360);
    expect(block).toContain('setWorkflowPhase("storyboard")');
    expect(block).toContain('setImmersiveWorkspaceView("workbench")');
  });

  it("四个用户可见出口全部走收口函数", () => {
    // 回到剧本工作室 + onGoWorkbench + 三处「切经典表单」
    const calls = SRC.match(/closeClipDockToWorkbench/g) || [];
    // 1 处定义 + 5 处调用
    expect(calls.length).toBeGreaterThanOrEqual(6);
    expect(SRC).toContain("onClick={closeClipDockToWorkbench}");
  });

  it("沉浸工作区必须把工作台、编剧室、成片坞做成互斥页签", () => {
    expect(SRC).toContain('role="tablist"');
    expect(SRC).toContain('immersiveWorkspaceView === "topic"');
    expect(SRC).toContain('immersiveWorkspaceView === "clip_dock"');
    expect(SRC).toMatch(/immersiveWorkspaceView !== "topic"[\s\S]{0,80}\? "hidden"/);
    expect(SRC).toMatch(/immersiveWorkspaceView !== "clip_dock"[\s\S]{0,80}\? "hidden"/);
    expect(SRC).toContain("min-h-0 flex-1 overflow-y-auto border-t");
  });

  it("三栏工作台不能恢复 1180/1360 像素硬宽度", () => {
    expect(WORKBENCH_SRC).not.toContain("min-w-[1180px]");
    expect(WORKBENCH_SRC).not.toContain("min-w-[1360px]");
    expect(WORKBENCH_SRC).toContain("min-w-[840px]");
    expect(WORKBENCH_SRC).toContain("xl:min-w-0");
  });

  it("顶部只常驻主流程动作，低频控件按三组收进更多操作", () => {
    expect(WORKBENCH_SRC).toContain('data-manhua-action="open-more-tools"');
    expect(WORKBENCH_SRC).toContain("data-manhua-toolbar-more");
    expect(WORKBENCH_SRC).toContain('data-manhua-toolbar-group="director-assets"');
    expect(WORKBENCH_SRC).toContain('data-manhua-toolbar-group="generation-workspace"');
    expect(WORKBENCH_SRC).toContain('data-manhua-toolbar-group="continuity-entries"');

    const reviewAt = WORKBENCH_SRC.indexOf('data-manhua-action="review-clip-prompts"');
    const moreAt = WORKBENCH_SRC.indexOf("data-manhua-toolbar-more");
    const localClipAt = WORKBENCH_SRC.indexOf('data-manhua-action="generate-fragment"');
    expect(reviewAt).toBeGreaterThan(0);
    expect(moreAt).toBeGreaterThan(reviewAt);
    expect(localClipAt).toBeGreaterThan(moreAt);
    expect(WORKBENCH_SRC.match(/data-manhua-action="generate-fragment"/g)).toHaveLength(1);
  });

  it("生成中仍只把中断按钮放在顶栏，不把它藏进更多操作", () => {
    const stopAt = WORKBENCH_SRC.indexOf('data-manhua-action="stop-factory"');
    const moreAt = WORKBENCH_SRC.indexOf("data-manhua-toolbar-more");
    expect(stopAt).toBeGreaterThan(0);
    expect(stopAt).toBeLessThan(moreAt);
    expect(WORKBENCH_SRC).toContain("factoryBusy && onStopFactory ? null : (");
  });
});
