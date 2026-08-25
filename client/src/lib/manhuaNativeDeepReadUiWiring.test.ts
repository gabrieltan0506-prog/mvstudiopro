import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(new URL("../pages/PlatformPage.tsx", import.meta.url), "utf8");
const START = PAGE.indexOf("const runManhuaTemplateLearnCloud = useCallback");
const END = PAGE.indexOf("/**\n   * 刷新/断线恢复", START);
const LEARN_FLOW = PAGE.slice(START, END);

describe("原生精读页面接线", () => {
  it("点击后直接建立持久任务，不先调用预演接口或二次确认", () => {
    const createAt = LEARN_FLOW.indexOf("createJob");
    expect(START).toBeGreaterThan(0);
    expect(createAt).toBeGreaterThan(0);
    expect(LEARN_FLOW).not.toContain("previewNativeDeepReadPlanMutation");
    expect(LEARN_FLOW).not.toContain("window.confirm");
    for (const field of [
      "nativeDeepReadConfirmed",
      "nativeMaxCalls",
      "nativePlanLimit",
    ]) {
      expect(LEARN_FLOW).toContain(field);
    }
  });

  it("权限状态未确认时关闭式停止，不回落旧链", () => {
    expect(LEARN_FLOW).toContain("manhuaTemplateOwnerCapabilitiesQuery.isLoading");
    expect(LEARN_FLOW).toContain("权限状态未确认前不会回落旧学习链");
  });

  it("权限明确拒绝时也停止，不会静默建立旧任务", () => {
    const deniedAt = LEARN_FLOW.indexOf('nativeGate === "blocked_not_owner"');
    const previewAt = LEARN_FLOW.indexOf('nativeGate === "ready"');
    const createAt = LEARN_FLOW.indexOf("createJob", previewAt);
    expect(deniedAt).toBeGreaterThan(0);
    expect(LEARN_FLOW).toContain("本次未建立任务，也没有回落旧学习链");
    expect(previewAt).toBeGreaterThan(deniedAt);
    expect(createAt).toBeGreaterThan(previewAt);
  });

  it("owner 面板使用原生精读说明与直接开始按钮", () => {
    expect(PAGE).toContain("nativeDeepRead: ownerNativeDeepReadPanel");
    expect(PAGE).toContain("MANHUA_NATIVE_DEEP_READ_MODEL_LABEL");
    expect(PAGE).toContain("学习模型：正在确认…");
    expect(PAGE).toContain("· 原生视频精读");
    expect(PAGE).toContain("开始精读 ${manhuaLearnBatchSize} 集");
    expect(PAGE).not.toContain("预演并精读 ${manhuaLearnBatchSize} 集");
    expect(PAGE).toContain("旧抽帧任务");
  });

  it("原生精读徽标显示真实 Qwen 模型，不拿旧抽帧模型冒充", () => {
    expect(PAGE).toContain("学习模型：${MANHUA_NATIVE_DEEP_READ_MODEL_LABEL}");
    expect(LEARN_FLOW).not.toContain("MANHUA_TEMPLATE_FRAME_VISION_LABEL");
  });

  it("任务交给服务端列表恢复，页面展示原生模式与用量回执", () => {
    expect(LEARN_FLOW).toContain("await refreshManhuaLearnServerJobs()");
    expect(PAGE).toContain('manhuaLearnResult.pipelineMode === "native_deep_read"');
    expect(PAGE).toContain("manhuaLearnResult.nativeUsage");
    expect(PAGE).toContain("nativeLearnTerminalProposalRefreshSignature");
    expect(PAGE).toContain("await manhuaViralProposalsRefetchRef.current()");
  });

  it("轮询 effect 不依赖整颗 query 对象，且无变化快照复用旧引用", () => {
    expect(PAGE).toContain("reuseManhuaLearnServerJobsIfUnchanged(prev, listed.items)");
    expect(PAGE).toContain("manhuaViralProposalsRefetchRef.current = manhuaViralProposalsQuery.refetch");
    const refreshAt = PAGE.indexOf("const refreshManhuaLearnServerJobs = useCallback");
    const stopAt = PAGE.indexOf("const stopFocusedManhuaLearnJob", refreshAt);
    const refreshBlock = PAGE.slice(refreshAt, stopAt);
    expect(refreshBlock).not.toContain("[manhuaLearnActiveJob, manhuaLearnFocusSeriesKey, manhuaViralProposalsQuery]");
  });

  it("页面没有任何供应商生产密钥入口", () => {
    expect(PAGE).not.toMatch(/VITE_[A-Z0-9_]*(?:API_?KEY|SECRET|TOKEN)/);
  });
});
