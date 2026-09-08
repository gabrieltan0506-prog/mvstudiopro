import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// 执行实际路由的成品后异常分支，确保故障不落入其后的退款逻辑。
const source = readFileSync(new URL("../routers.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("routers.ts", source, ts.ScriptTarget.Latest, true);
const branches: ts.IfStatement[] = [];
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(tree) === "readingRender && imageUrl") branches.push(node);
  ts.forEachChild(node, visit);
}
visit(tree);
if (branches.length !== 1) throw new Error("成品对账分支数量变化，需要重新检查入口");
const compiled = ts.transpileModule(branches[0].getText(tree).replaceAll("await import(", "await loadModule("), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
function harness() {
  const saveResult = vi.fn().mockResolvedValue(undefined);
  const saveFailure = vi.fn().mockResolvedValue(undefined);
  const saveJob = vi.fn().mockResolvedValue(true);
  const markPending = vi.fn().mockResolvedValue(true);
  const refund = vi.fn();
  const generate = vi.fn();
  const log = vi.fn();
  const run = new Function("dependencies", `return (async () => {
    const { saveKnowledgeCardReadingRenderResult, saveKnowledgeCardReadingRenderFailure, loadModule, refund, generate, console } = dependencies;
    const readingRender = { prefix: "test", progressJobId: "test-job" };
    const imageUrl = "https://test.invalid/produced.png";
    const progressJobId = "test-job";
    const compositeHoldJobId = "test-hold";
    const compositeHoldRegistered = true;
    const imageGenFlowLog = [];
    ${compiled}
    refund(); generate();
  })();`);
  return { saveResult, saveFailure, saveJob, markPending, refund, generate, log, run: () => run({
    saveKnowledgeCardReadingRenderResult: saveResult, saveKnowledgeCardReadingRenderFailure: saveFailure,
    loadModule: async () => ({ markJobSucceededWithRetry: saveJob, markSettlementPending: markPending }),
    refund, generate, console: { error: log },
  }) };
}
describe("知识卡成品后写入失败分支", () => {
  it("成品、任务、结算全部保存失败，显式保留 reconciliation 且不退款/重生", async () => {
    const h = harness(); h.saveResult.mockRejectedValue(new Error("测试GCS写入失败"));
    h.saveJob.mockResolvedValue(false); h.markPending.mockResolvedValue(false);
    await h.run();
    expect(h.saveFailure).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("对账"), false);
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining("禁止自动退款"), expect.objectContaining({ settlementSaved: false, resultSaved: false, jobSaved: false }));
    expect(h.refund).not.toHaveBeenCalled(); expect(h.generate).not.toHaveBeenCalled();
  });
  it("所有故障连 reconciliation 也写不进时不逃逸到退款分支", async () => {
    const h = harness();
    for (const fn of [h.saveResult, h.saveFailure, h.saveJob, h.markPending]) fn.mockRejectedValue(new Error("测试全存储故障"));
    await expect(h.run()).resolves.toBeUndefined();
    expect(h.refund).not.toHaveBeenCalled(); expect(h.generate).not.toHaveBeenCalled();
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining("原页面占用和付费账本保留"), expect.any(Error));
  });
  it("有一份可靠成品记录时不新增遮挡结果的 failure 回执", async () => {
    const h = harness(); h.saveResult.mockRejectedValue(new Error("测试GCS故障"));
    await h.run(); expect(h.saveFailure).not.toHaveBeenCalled();
    expect(h.refund).not.toHaveBeenCalled(); expect(h.generate).not.toHaveBeenCalled();
  });
  it("markSettlementPending false 被显式记录，不能谎报保存成功", async () => {
    const h = harness(); h.markPending.mockResolvedValue(false);
    await h.run();
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining("等待对账"), expect.objectContaining({ settlementSaved: false }));
    expect(h.saveFailure).not.toHaveBeenCalled(); expect(h.refund).not.toHaveBeenCalled();
  });
});
