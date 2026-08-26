import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(new URL("../pages/PlatformPage.tsx", import.meta.url), "utf8");
const RESULT_UI = readFileSync(new URL("./manhuaLearnResultUi.ts", import.meta.url), "utf8");
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
    expect(LEARN_FLOW.match(/createJob\(/g)).toHaveLength(1);
    expect(LEARN_FLOW).not.toContain("pollJobUntilTerminal");
    expect(LEARN_FLOW).not.toContain("95 * 60_000");
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

  it("owner 能力只信服务端本次回包；加载中显示中性状态且禁止发车", () => {
    expect(PAGE).toContain(
      "manhuaTemplateOwnerCapabilitiesQuery.data?.allowed === true",
    );
    expect(PAGE).toContain('{ cacheScope: manhuaLearnUserKey || "anonymous" }');
    expect(PAGE).not.toContain("readCachedManhuaOwnerPanelFlag");
    expect(PAGE).not.toContain("writeCachedManhuaOwnerPanelFlag");
    expect(PAGE).toContain('const ownerTemplateCapabilityPending =');
    expect(PAGE).toContain('"学习模型：正在确认…"');
    expect(PAGE).toContain('|| ownerTemplateCapabilityPending');
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
    expect(PAGE).toContain("await manhuaClaimsRefetchRef.current()");
    expect(PAGE).toContain("if (!terminalRefreshFailed)");
  });

  it("模型、token、成本和原始进度只通过 owner/监管技术详情门展示", () => {
    expect(PAGE).toContain(
      "const canSeeManhuaLearnTechnicalDetails =\n    hasSupervisorOpsAccess || ownerTemplateOptimizeAllowed;",
    );
    expect(PAGE).toContain(
      "canSeeManhuaLearnTechnicalDetails && manhuaLearnResult.nativeUsage",
    );
    expect(PAGE).toContain(
      "canSeeManhuaLearnTechnicalDetails\n                            && (manhuaLearnResult.progressLines?.length || 0) > 0",
    );
    expect(PAGE).toContain("getManhuaLearnSafeProgressLabelZh(manhuaLearnResult)");
    expect(PAGE).toContain('"学习方式：云端按集处理"');
  });

  it("逐次模型回执只从当前服务端 Job 读取并仅向 owner 展示", () => {
    expect(PAGE).toContain(
      "focusedManhuaLearnServerJob?.output?.nativeModelReceipts",
    );
    expect(PAGE).toContain("parseManhuaNativeModelReceipts(");
    expect(PAGE).toContain(
      "ownerTemplateOptimizeAllowed\n                            && focusedManhuaNativeModelReceipts.length > 0",
    );
    expect(PAGE).toContain("逐次模型回执（{focusedManhuaNativeModelReceipts.length}）");
    const resultTypeStart = RESULT_UI.indexOf("export type ManhuaLearnResultUi = {");
    const resultTypeEnd = RESULT_UI.indexOf("\n};", resultTypeStart);
    expect(RESULT_UI.slice(resultTypeStart, resultTypeEnd)).not.toContain("nativeModelReceipts");
  });

  it("轮询 effect 不依赖整颗 query 对象，且无变化快照复用旧引用", () => {
    expect(PAGE).toContain("reuseManhuaLearnServerJobsIfUnchanged(prev, listed.items)");
    expect(PAGE).toContain("manhuaViralProposalsRefetchRef.current = manhuaViralProposalsQuery.refetch");
    expect(PAGE).toContain("manhuaClaimsRefetchRef.current = manhuaClaimsQuery.refetch");
    const refreshAt = PAGE.indexOf("const refreshManhuaLearnServerJobs = useCallback");
    const stopAt = PAGE.indexOf("const stopFocusedManhuaLearnJob", refreshAt);
    const refreshBlock = PAGE.slice(refreshAt, stopAt);
    expect(refreshBlock).toContain("manhuaLearnFocusSeriesKeyRef.current");
    expect(refreshBlock).toContain("manhuaLearnActiveJobRef.current");
    expect(refreshBlock).toContain("reuseManhuaLearnResultIfUnchanged(prev, focused.result)");
    expect(refreshBlock).not.toContain("[manhuaLearnActiveJob, manhuaLearnFocusSeriesKey");
    const recoveryAt = PAGE.indexOf("刷新/断线恢复：接管同一个后台 job");
    const approveAt = PAGE.indexOf("const approveManhuaLearnProposal", recoveryAt);
    const recoveryBlock = PAGE.slice(recoveryAt, approveAt);
    expect(recoveryBlock).toContain("manhuaViralProposalsRefetchRef.current()");
    expect(recoveryBlock).not.toContain("manhuaViralProposalsQuery.refetch");
  });

  it("认证用户到位后才按用户恢复，失败记录不会霸占默认页", () => {
    expect(PAGE).toContain("resolveManhuaLearnReloadDecision({");
    expect(PAGE).not.toContain("manhuaLearnReloadBootstrap");
    expect(PAGE).toContain("readManhuaLearnActiveJob(manhuaLearnUserKey)");
    expect(PAGE).toContain("readManhuaLearnResult(manhuaLearnUserKey)");
    expect(PAGE).toContain("readManhuaLearnFocusSeriesKey(manhuaLearnUserKey)");
    expect(PAGE).toContain("readManhuaLearnContinuation(manhuaLearnUserKey)");
    expect(PAGE).toContain(
      '`${MANHUA_LEARN_CONTINUATION_LS_KEY}:${encodeURIComponent(scope)}`',
    );
    const resetAt = PAGE.indexOf("if (decision.clearFailedAutoResume) {");
    expect(resetAt).toBeGreaterThan(0);
    const resetBlock = PAGE.slice(resetAt, resetAt + 500);
    expect(resetBlock).toContain('writeManhuaLearnFocusSeriesKey(manhuaLearnUserKey, "")');
    expect(resetBlock).toContain("writeManhuaLearnResult(manhuaLearnUserKey, null)");
    expect(resetBlock).toContain("writeManhuaLearnContinuation(manhuaLearnUserKey, null)");
  });

  it("身份切换丢弃上一账号在途轮询回包，快照换引用不强制展开面板", () => {
    expect(PAGE).toContain("manhuaLearnUserKeyRef.current !== requestUserKey");
    expect(PAGE).toContain("setManhuaLearnHydratedUserKey(manhuaLearnUserKey)");
    const snapshotAt = PAGE.indexOf("const snap = manhuaLearnSnapshotQuery.data;");
    const selectAt = PAGE.indexOf("const selectManhuaLearnBasketItem", snapshotAt);
    const snapshotBlock = PAGE.slice(snapshotAt, selectAt);
    expect(snapshotBlock).toContain("reuseManhuaLearnResultIfUnchanged(prev, next)");
    expect(snapshotBlock).not.toContain("setManhuaLearnPanelCollapsed(false)");
  });

  it("待审批学到的结构完整消费 storyStructure 五个字段", () => {
    expect(PAGE).toContain("selectedManhuaProposal.storyStructure ||");
    for (const field of [
      "corePromiseZh",
      "conflictEngineZh",
      "relationshipEngineZh",
      "episodeProgressionZh",
      "variationRulesZh",
    ]) {
      expect(PAGE).toContain(`selectedManhuaProposal.storyStructure.${field}`);
    }
    for (const label of [
      "核心故事承诺｜",
      "持续冲突引擎｜",
      "关系变化引擎｜",
      "跨集推进规律｜",
      "避免重复规则｜",
    ]) {
      expect(PAGE).toContain(label);
    }
    expect(PAGE).toContain("故事骨架｜旧卡未记录五项系列骨架");
    expect(PAGE).toContain("selectedManhuaProposal.beatGrid?.length ||");
    expect(PAGE).toContain("selectedManhuaProposal.reusableZh ||");
  });

  it("页面没有任何供应商生产密钥入口", () => {
    expect(PAGE).not.toMatch(/VITE_[A-Z0-9_]*(?:API_?KEY|SECRET|TOKEN)/);
  });
});
