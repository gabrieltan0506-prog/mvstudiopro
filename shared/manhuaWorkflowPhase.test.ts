/**
 * 阶段枚举收口回归。
 *
 * 此前这个枚举在四处各写一遍（组件类型、持久化类型、本文件校验、OmniCanvas 的
 * state 与恢复校验）。加一个阶段要同时改四处，漏掉任一处的后果是
 * 「选了新阶段、刷新后回到大纲」**且不报错** —— 正是最难查的那类雷。
 */
import { describe, expect, it } from "vitest";
import {
  MANHUA_WORKFLOW_PHASES,
  buildManhuaWriterSession,
  parseManhuaWorkflowPhase,
} from "./manhuaWriterSession";

describe("阶段枚举收口", () => {
  it("五格齐全且顺序即闭环顺序", () => {
    expect([...MANHUA_WORKFLOW_PHASES]).toEqual([
      "outline",
      "assets",
      "storyboard",
      "edit",
      "final",
    ]);
  });

  it("每个合法阶段都原样保留 —— 漏一个就会静默回落到大纲", () => {
    for (const phase of MANHUA_WORKFLOW_PHASES) {
      expect(parseManhuaWorkflowPhase(phase, true)).toBe(phase);
      expect(parseManhuaWorkflowPhase(phase, false)).toBe(phase);
    }
  });

  it("未知值按是否确认编剧回落", () => {
    expect(parseManhuaWorkflowPhase("nope", true)).toBe("storyboard");
    expect(parseManhuaWorkflowPhase(undefined, false)).toBe("outline");
    expect(parseManhuaWorkflowPhase(null, false)).toBe("outline");
  });

  it("成片阶段能存进会话并原样读回（第五格可持久化）", () => {
    const session = buildManhuaWriterSession({
      topic: "t",
      writerConfirmed: true,
      workflowPhase: "final",
    } as never);
    expect(session.workflowPhase).toBe("final");
  });
});
