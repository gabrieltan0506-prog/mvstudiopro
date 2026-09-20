import { describe, expect, it } from "vitest";
import { buildManhuaMainTaskState } from "./manhuaMainTaskBlockers";
import type { AdvisorIssue } from "./manhuaAdvisorProject";

const issue = (id: string, phase: string, blocking: boolean): AdvisorIssue => ({
  id,
  text: `${id} 的说明`,
  phase: phase as AdvisorIssue["phase"],
  blocking,
});

describe("阻断卡集中显示", () => {
  it("当前阶段的阻断项排最前，卡头报本步几条与全片几条", () => {
    const state = buildManhuaMainTaskState({
      issues: [
        issue("keyframe", "storyboard", true),
        issue("asset-gap", "assets", true),
        issue("claims", "assets", false),
        issue("gate", "assets", true),
      ],
      phase: "assets",
    });
    expect(state.blocked).toBe(true);
    expect(state.blockers.map((i) => i.id)).toEqual(["asset-gap", "gate", "keyframe"]);
    expect(state.headlineZh).toBe("本步卡着 2 条，全片共 3 条要解");
    // 提醒项不许被藏掉——藏提示正是线上那个毛病本身
    expect(state.advisories.map((i) => i.id)).toEqual(["claims"]);
  });

  it("本步没阻断但别处有：不说「可以往下走」，如实说其他步骤还有几条", () => {
    const state = buildManhuaMainTaskState({
      issues: [issue("keyframe", "storyboard", true), issue("review", "assets", false)],
      phase: "assets",
    });
    expect(state.blocked).toBe(true);
    expect(state.headlineZh).toBe("其他步骤还有 1 项需要处理");
  });

  it("只有提醒项时不算阻断，卡整张不渲染", () => {
    const state = buildManhuaMainTaskState({
      issues: [issue("claims", "assets", false), issue("rig", "storyboard", false)],
      phase: "assets",
    });
    expect(state.blocked).toBe(false);
    expect(state.headlineZh).toBe("");
    expect(state.hintZh).toBe("");
    expect(state.blockers).toEqual([]);
    // 反例对照：同样这批数据里任意一条改成阻断，就必须变成 blocked
    const flipped = buildManhuaMainTaskState({
      issues: [issue("claims", "assets", true), issue("rig", "storyboard", false)],
      phase: "assets",
    });
    expect(flipped.blocked).toBe(true);
  });

  it("生成中不抢主操作的位置：此刻主操作是「中断」，不是「往下走」", () => {
    const state = buildManhuaMainTaskState({
      issues: [issue("gate", "assets", true)],
      phase: "assets",
      busy: true,
    });
    expect(state.blocked).toBe(false);
    expect(state.blockers.map((i) => i.id)).toEqual(["gate"]); // 数据仍在，只是不弹卡
  });

  it("零问题时一切为空，不造假阻断", () => {
    const state = buildManhuaMainTaskState({ issues: [], phase: "outline" });
    expect(state).toEqual({ blocked: false, blockers: [], advisories: [], headlineZh: "", hintZh: "" });
  });
});
