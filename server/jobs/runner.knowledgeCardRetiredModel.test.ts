import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareKnowledgeCardCopy } from "../services/knowledgeCardDistill";
import { planKnowledgeCardPages } from "../../shared/knowledgeCardPagination";
import { knowledgeCardDistillFeeForModel, knowledgeCardPageCreditsForModel } from "../../shared/knowledgeCardDistillModels";

// 执行真实worker分支及真实prepare，所有网络、账本和存储边界禁止调用。
const source = ts.createSourceFile("runner.ts", readFileSync(new URL("./runner.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
let branch = "";
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(source) === 'input.action === "knowledge_card_distill"'
    && node.thenStatement.getText(source).includes("prepareKnowledgeCardCopy")) branch = node.thenStatement.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
if (!branch) throw new Error("未找到真实知识卡worker分支");
const code = ts.transpileModule(`async function run(input, jobUserId, platformJobId) { const params=input.params; ${branch} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/\bimport\(/g, "importModule(");
afterEach(() => vi.unstubAllGlobals());

describe("旧提炼任务不能在恢复执行时静默涨费", () => {
  it.each(["moonshotai/kimi-k3", "claude-opus-5"])("%s在真实worker内先拒绝，再无收费和回执写入", async distillModel => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const deduct = vi.fn();
    const patch = vi.fn();
    const unexpected = vi.fn(async (name: string) => { throw new Error(`不应调用外部模块: ${name}`); });
    const importModule = async (name: string) => {
      if (name === "../services/knowledgeCardDistill.js") return { prepareKnowledgeCardCopy };
      if (name === "../../shared/knowledgeCardPagination.js") return { planKnowledgeCardPages };
      return unexpected(name);
    };
    const run = new Function("importModule", "deductCreditsAmount", "patchJobRunningProgress", `${code}\nreturn run;`)(importModule, deduct, patch);
    const input = { action: "knowledge_card_distill", params: { distillModel, sourceText: "已提交的原始材料保留", imageDataUrls: ["data:image/png;base64,dGVzdA=="], chargeDistillFee: true } };
    const original = JSON.stringify(input);
    await expect(run(input, "7", "old-job")).rejects.toMatchObject({ code: "KNOWLEDGE_CARD_MODEL_RETIRED" });
    expect(deduct).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(unexpected).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(input)).toBe(original);
    // 历史回执不迁档，Kimi原提炼费40和页费27仍可核对。
    expect(knowledgeCardDistillFeeForModel("moonshotai/kimi-k3")).toBe(40);
    expect(knowledgeCardPageCreditsForModel("moonshotai/kimi-k3").full).toBe(27);
  });
});
