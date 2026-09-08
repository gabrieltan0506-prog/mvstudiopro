import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KNOWLEDGE_CARD_ACTIVE_DISTILL_MODELS } from "../../shared/knowledgeCardDistillModels";
import { knowledgeCardReadingConstraintsSchema, KNOWLEDGE_CARD_READING_MODES } from "../../shared/knowledgeCardReadingPlan";

const source = ts.createSourceFile("runner.ts", readFileSync(new URL("./runner.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
let branch = "";
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(source) === 'input.action === "knowledge_card_reading" || input.action === "knowledge_card_edition"'
    && node.thenStatement.getText(source).includes("prepareKnowledgeCardReadingEdition")) branch = node.thenStatement.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
if (!branch) throw new Error("找不到真实详细稿worker分支");
const code = ts.transpileModule(`async function run(input, jobUserId, platformJobId, signal) { const params=input.params; ${branch} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/\bimport\(/g, "importModule(");
const planId = `${"a".repeat(64)}-${"b".repeat(64)}`;
const input = () => ({ action: "knowledge_card_edition", params: { planId, mode: "complete", userId: 999, model: "qwen3.8-max" } });
const edition = {
  editionId: "c".repeat(64), planId, mode: "complete", model: "gpt-5.6-sol", credits: 120,
  pages: Array.from({ length: 4 }, (_, index) => ({ pageId: `p${index + 1}`, ordinal: index + 1, title: `标题${index + 1}`, contentMarkdown: "完整正文", visualDirections: "原稿结构", sourcePageIds: ["s1", "s2"], referencePageIds: ["s2"], imageGsUris: ["gs://test/image.png"] })),
};
function fixture(prepare = vi.fn(async (_input: unknown, progress: (done: number, total: number, phase: string) => Promise<void>, _signal?: AbortSignal) => {
  await progress(4, 4, "writing"); return edition;
})) {
  const patch = vi.fn(async (_jobId: string, _progress: Record<string, unknown>) => undefined);
  const unexpected = vi.fn(async (name: string) => { throw new Error(`不允许其他模型/收费/删除边界：${name}`); });
  const importModule = async (name: string) => {
    if (name === "zod") return { z };
    if (name === "../../shared/knowledgeCardDistillModels.js") return { KNOWLEDGE_CARD_ACTIVE_DISTILL_MODELS };
    if (name === "../../shared/knowledgeCardReadingPlan.js") return { knowledgeCardReadingConstraintsSchema, KNOWLEDGE_CARD_READING_MODES };
    if (name === "../services/knowledgeCardReadingEdition.js") return { prepareKnowledgeCardReadingEdition: prepare };
    return unexpected(name);
  };
  const run = new Function("importModule", "patchJobRunningProgressStrict", `${code}\nreturn run;`)(importModule, patch);
  return { run, prepare, patch, unexpected };
}
afterEach(() => vi.useRealTimers());

describe("冻结详细稿的真实平台worker接线", () => {
  it("只用队列账号、planId和mode，返回output.edition完整结构而非裸版本", async () => {
    const { run, prepare, patch, unexpected } = fixture();
    const original = input();
    const snapshot = JSON.stringify(original);
    const result = await run(original, "7", "edition-job", new AbortController().signal);
    expect(prepare.mock.calls[0]![0]).toEqual({ userId: 7, planId, mode: "complete" });
    expect(prepare.mock.calls[0]![2]).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({ provider: "evolink", output: { success: true, edition, readingDonePages: 4, readingTotalPages: 4, readingPhase: "done", readingProgressUpdatedAt: expect.any(String), readingHeartbeatAt: expect.any(String) } });
    expect(result.output.edition.pages[0].sourcePageIds).toEqual(["s1", "s2"]);
    expect(result.output.edition.pages[0].referencePageIds).toEqual(["s2"]);
    expect(patch).toHaveBeenCalledWith("edition-job", { readingDonePages: 4, readingTotalPages: 4, readingPhase: "writing", readingProgressUpdatedAt: expect.any(String), readingHeartbeatAt: expect.any(String) });
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(unexpected).not.toHaveBeenCalled();
  });
  it("非法身份、无job、越权路径和未知方案模式在服务前拒绝", async () => {
    const { run, prepare } = fixture();
    await expect(run(input(), "999user", "job")).rejects.toThrow("可信");
    await expect(run(input(), "7", undefined)).rejects.toThrow("可信");
    await expect(run({ ...input(), params: { ...input().params, planId: "../u8/plan" } }, "7", "job")).rejects.toThrow();
    await expect(run({ ...input(), params: { ...input().params, mode: "cheap" } }, "7", "job")).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled();
  });
  it("详细编稿失败不返回空版本、不覆盖旧输出或调用阅读/收费清理边界", async () => {
    const failure = new Error("第3页回复不完整，已保留原始回复");
    const prepare = vi.fn(async (_input: unknown, progress: (done: number, total: number, phase: string) => Promise<void>) => {
      await progress(2, 4, "writing"); throw failure;
    });
    const { run, patch, unexpected } = fixture(prepare);
    const original = input();
    const snapshot = JSON.stringify(original);
    await expect(run(original, "7", "job")).rejects.toBe(failure);
    expect(patch.mock.calls.at(-1)).toEqual(["job", { readingDonePages: 2, readingTotalPages: 4, readingPhase: "writing", readingProgressUpdatedAt: expect.any(String), readingHeartbeatAt: expect.any(String) }]);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(unexpected).not.toHaveBeenCalled();
  });
  it("外层中止贯穿编稿signal，晚到版本不作为成功结果交付", async () => {
    const controller = new AbortController();
    const prepare = vi.fn(async (_input: unknown, _progress: unknown, signal?: AbortSignal) => {
      controller.abort(new Error("编稿超时"));
      expect(signal!.aborted).toBe(true);
      return edition;
    });
    const { run } = fixture(prepare);
    await expect(run(input(), "7", "job", controller.signal)).rejects.toThrow("编稿超时");
  });
});
