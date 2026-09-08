import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { listReadingSessions, loadReadingSession, saveReadingSession, readingEditionImages, type KnowledgeCardReadingSession } from "./knowledgeCardReadingSession";
import { knowledgeCardDistillFeeForModel } from "@shared/knowledgeCardDistillModels";
import { KNOWLEDGE_CARD_SKIP_DISTILL_MAX_CHARS, knowledgeCardCreditsForPageIndex } from "@shared/knowledgeCardPagination";
import { resolveKnowledgeCardSubjectPosition } from "@shared/knowledgeCardSubjectPosition";
const source = readFileSync(new URL("../pages/PlatformPage.tsx", import.meta.url), "utf8");
// 执行父页实际控制器，不复制其状态判断。
const code = source.slice(source.indexOf("  const prepareReadingMutation ="), source.indexOf("  const resumeKnowledgeReading ="));
const resumeStart = source.indexOf("  const resumeKnowledgeReading =");
const ast = ts.createSourceFile("parent.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let resumeCode = "";
let replanCode = "";
function find(node: ts.Node) {
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === "resumeKnowledgeReading")) resumeCode = node.getText(ast);
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "KnowledgeCardReadingPlans") {
    const attribute = node.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText(ast) === "onAnalyze") as ts.JsxAttribute;
    replanCode = ((attribute.initializer as ts.JsxExpression).expression!).getText(ast);
  }
  ts.forEachChild(node, find);
}
find(ast);
if (!resumeStart || !resumeCode) throw Error("找不到父页阅读控制器");
const controller = ts.transpileModule(`${code}\n${resumeCode}\nconst replan=${replanCode};\nreturn {replan,refreshReadingSuccessPages,retryKnowledgeReadingPage,startKnowledgeReadingFiles,startKnowledgeReadingText,renderReadingEdition,resumeKnowledgeReading,withReadingOperation,saveReading,get:()=>readingSessionRef.current};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const makeSession = (): KnowledgeCardReadingSession => ({ version: 1, id: "test-session", userId: 7, model: "gpt-5.6-sol", files: [{ gcsUri: "gs://test-bucket/original.pdf", mimeType: "application/pdf", fileName: "original.pdf" }], constraints: {}, phase: "ready", selectedMode: "complete", planId: "test-plan", pageTasks: {}, edition: { editionId: "test-edition", planId: "test-plan", mode: "complete", model: "gpt-5.6-sol", credits: 200, pages: [1, 2, 3, 4].map(ordinal => ({ pageId: `page-${ordinal}`, ordinal, title: `第${ordinal}页标题`, contentMarkdown: `第${ordinal}页独立正文`, visualDirections: "原页参考和说明对应", referencePageIds: ["source-1"], imageGsUris: ["gs://test-bucket/page.png"] })) } });
function setup(saved?: KnowledgeCardReadingSession) {
  const storage = new Map<string, string>();
  const localStorage = { get length() { return storage.size; }, key: (index: number) => Array.from(storage.keys())[index] ?? null, getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) };
  if (saved) saveReadingSession(localStorage, saved);
  const images = vi.fn();
  const confirm = vi.fn((..._args: any[]) => true);
  const prepare = vi.fn(async (..._args: any[]) => { expect(loadReadingSession(localStorage, 7)?.pending).toBe("reading"); return { progressJobId: "reading-job" }; });
  const resume = vi.fn(async (..._args: any[]) => ({ progressJobId: "existing-job", status: "queued" }));
  const generate = vi.fn(async (_input: any): Promise<any> => ({ imageUrl: "test-image" }));
  const status = vi.fn(async ({ pageId }: { pageId: string }): Promise<any> => ({ status: "succeeded", imageUrl: `image-${pageId}`, progressJobId: `job-${pageId}` }));
  const poll = vi.fn(async (): Promise<any> => ({ status: "succeeded", output: { planId: "test-plan" } }));
  const getPlan = vi.fn(async () => ({ planId: "test-plan", constraints: loadReadingSession(localStorage, 7)?.constraints ?? {}, plan: { version: 1, sourceDigest: "a".repeat(64), model: "gpt-5.6-sol", presentation: "single", reason: "完成全文阅读", options: [{ mode: "complete", reason: "内容完整", kept: ["图文"], omitted: [], pages: [1, 2, 3, 4].map(i => ({ pageId: `p${i}`, title: "标题", brief: "具体内容", sourcePageIds: ["source-1"], visualDirections: "原页定位" })) }] } }));
  const upload = vi.fn(async ({ file }: { file: File }) => `gs://test-bucket/${file.name}`);
  const env: Record<string, unknown> = {
    trpc: { mvAnalysis: { prepareKnowledgeCardReading: { useMutation: () => ({ mutateAsync: prepare }) }, prepareKnowledgeCardReadingEdition: { useMutation: () => ({ mutateAsync: vi.fn() }) }, resumeKnowledgeCardReadingJob: { useMutation: () => ({ mutateAsync: resume }) } } },
    useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [value, vi.fn()], useEffect: (fn: () => void) => fn(),
    user: { id: 7 }, window: { confirm }, knowledgeCardDistillFeeForModel, KNOWLEDGE_CARD_SKIP_DISTILL_MAX_CHARS, knowledgeCardCreditsForPageIndex, customNoteText: "正文", localStorage, listReadingSessions, loadReadingSession, saveReadingSession, readingEditionImages,
    setCustomNoteImages: images, setCustomNoteMaterialSeed: vi.fn(), setCustomNoteImageUpper: vi.fn(), setCustomNoteImageLower: vi.fn(), setCustomNoteBusy: vi.fn(), setCustomNoteUploadBusy: vi.fn(), setCustomNoteUploadStatus: vi.fn(), setCustomNoteKind: vi.fn(), setOutputType: vi.fn(), setCustomNotePageProgress: vi.fn(),
    toast: { error: vi.fn() }, pollJobUntilTerminal: poll, uploadKnowledgeCardFileToGcs: upload,
    getUploadUrlMutation: { mutateAsync: vi.fn() }, customNoteDistillModel: "gpt-5.6-sol", customNoteSubjectPosition: "center", customNoteInfographicTemplateId: "anatomy", customNoteImages: ["old-image"], customNoteImageUpper: null, customNoteImageLower: null,
    resolveKnowledgeCardSubjectPosition, generateCustomNoteMutation: { mutateAsync: generate }, COMPOSITE_SHEET_IMAGE_PROMPT_TRANSLATOR: "gpt", enabledPlatformSkillIds: new Set(), allowBloggerTitle: false,
    trpcUtils: { mvAnalysis: { getKnowledgeCardReadingPlan: { fetch: getPlan }, getKnowledgeCardReadingPageStatus: { fetch: status } } },
  };
  const result = new Function(...Object.keys(env), controller)(...Object.values(env));
  return { ...result, confirm, prepare, resume, generate, status, poll, upload, images, localStorage };
}
describe("父页实际阅读控制器", () => {
  it("小PDF同样直传原文件，提交前已保存，成功后取得方案且未出图", async () => {
    const run = setup();
    const file = new File(["测试PDF内容"], "original.pdf", { type: "application/pdf" });
    await run.startKnowledgeReadingFiles([file]);
    expect(run.upload.mock.calls[0][0].file).toBe(file);
    expect(run.prepare.mock.calls[0][0].files).toEqual([{ gcsUri: "gs://test-bucket/original.pdf", mimeType: "application/pdf", fileName: "original.pdf" }]);
    expect(run.get().phase).toBe("ready");
    expect(run.get().previousImages).toEqual(["old-image"]);
    expect(run.generate).not.toHaveBeenCalled();
  });
  it("长手输正文先明确确认原提炼费，取消零请求，确认才透传收费标记", async () => {
    const run = setup();
    run.confirm.mockReturnValueOnce(false);
    await run.startKnowledgeReadingText("甲".repeat(3201));
    expect(run.upload).not.toHaveBeenCalled();
    expect(run.prepare).not.toHaveBeenCalled();
    run.poll.mockResolvedValueOnce({ status: "succeeded", output: { planId: "test-plan", distillFeeCharged: 50 } });
    await run.startKnowledgeReadingText("甲".repeat(3201));
    expect(run.confirm.mock.calls[0][0]).toContain("50积分");
    expect(run.prepare.mock.calls[0][0].chargeDistillFee).toBe(true);
    expect(run.get().distillFeeCharged).toBe(50);
  });
  it("来自EPUB等文档的长文本不误收手输提炼费", async () => {
    const run = setup();
    await run.startKnowledgeReadingText("甲".repeat(3201), { fromDocument: true });
    expect(run.confirm).not.toHaveBeenCalled();
    expect(run.prepare.mock.calls[0][0].chargeDistillFee).toBeUndefined();
  });
  it("DOCX在上传前明确拒绝，不能抽文后冒充图文阅读", async () => {
    const run = setup();
    await expect(run.startKnowledgeReadingFiles([new File(["测试"], "document.docx")])).rejects.toThrow("导出PDF");
    expect(run.upload).not.toHaveBeenCalled();
  });
  it("提交断线保留页身份，刷新恢复查询同key且不重复提交", async () => {
    const run = setup(makeSession());
    run.status.mockResolvedValueOnce({ status: "not_started", progressJobId: "page-job" });
    run.generate.mockRejectedValueOnce(Error("测试断线"));
    await expect(run.withReadingOperation(() => run.renderReadingEdition(run.get()))).rejects.toThrow("测试断线");
    const saved = loadReadingSession(run.localStorage, 7)!;
    expect(saved.pending).toBe("page");
    expect(saved.pageTasks["page-1"]).toMatchObject({ attempt: 0, subjectPosition: "center", infographicTemplateId: "anatomy" });
    const resumed = setup(saved);
    await resumed.resumeKnowledgeReading();
    expect(resumed.generate).not.toHaveBeenCalled();
    expect(resumed.status.mock.calls[0][0]).toEqual({ editionId: "test-edition", pageId: "page-1", attempt: 0, subjectPosition: "center", infographicTemplateId: "anatomy" });
    expect(readingEditionImages(resumed.get())).toEqual(["image-page-1", "image-page-2", "image-page-3", "image-page-4"]);
  });
  it("阅读失败显式恢复同一job，先保存pending，不新建任务", async () => {
    const failed = makeSession();
    failed.edition = undefined; failed.plan = undefined; failed.planId = undefined;
    failed.phase = "failed"; failed.readingJobId = "original-reading-job";
    const run = setup(failed);
    run.resume.mockImplementationOnce(async ({ progressJobId }: { progressJobId: string }) => {
      expect(loadReadingSession(run.localStorage, 7)?.pending).toBe("reading");
      return { progressJobId, status: "queued" };
    });
    await run.resumeKnowledgeReading();
    expect(run.resume).toHaveBeenCalledWith({ progressJobId: "original-reading-job" });
    expect(run.prepare).not.toHaveBeenCalled();
    expect(run.get().phase).toBe("ready");
  });
  it("版次失败恢复原edition job后继续缺失图片，不重复新建版次", async () => {
    const failed = makeSession(); const edition = failed.edition;
    failed.edition = undefined; failed.phase = "failed"; failed.editionJobId = "original-edition-job";
    const run = setup(failed);
    run.poll.mockResolvedValueOnce({ status: "succeeded", output: { edition } });
    await run.resumeKnowledgeReading();
    expect(run.resume).toHaveBeenCalledWith({ progressJobId: "original-edition-job" });
    expect(run.get().edition.editionId).toBe("test-edition");
    expect(run.generate).not.toHaveBeenCalled();
  });
  it("费用对账状态保留pending与attempt，不发起购买或自动重试", async () => {
    const run = setup(makeSession());
    run.status.mockResolvedValueOnce({ status: "reconcile", progressJobId: "uncertain-fee-job" });
    await expect(run.withReadingOperation(() => run.renderReadingEdition(run.get()))).rejects.toThrow("核对原任务与费用");
    expect(run.get().pending).toBe("page");
    expect(run.get().pageTasks["page-1"].attempt).toBe(0);
    expect(run.generate).not.toHaveBeenCalled();
    expect(run.poll).not.toHaveBeenCalled();
  });
  it("超过5万字仍上传全文，预算重规划复用来源并保留原收费回执", async () => {
    const run = setup();
    const text = "甲".repeat(50_000) + "𠮷" + "乙".repeat(50_001);
    run.poll.mockResolvedValueOnce({ status: "succeeded", output: { planId: "test-plan", distillFeeCharged: 50 } });
    await run.startKnowledgeReadingText(text);
    expect(await run.upload.mock.calls[0][0].file.text()).toBe(text);
    const previousFiles = run.get().files;
    await run.replan({ budgetCredits: 300 });
    expect(run.upload).toHaveBeenCalledTimes(1);
    expect(run.confirm).toHaveBeenCalledTimes(1);
    expect(run.prepare.mock.calls[1][0]).toMatchObject({ files: previousFiles, constraints: { budgetCredits: 300 }, chargeDistillFee: true });
    expect(run.get().distillFeeCharged).toBe(50);
    expect(run.get().selectedMode).toBe("complete");
    expect(run.get().plan.options).toHaveLength(1);
  });
  it("收费确认后提交断线，刷新只恢复原授权且不再弹收费确认", async () => {
    const run = setup();
    run.prepare.mockRejectedValueOnce(Error("测试提交断线"));
    await expect(run.startKnowledgeReadingText("甲".repeat(3201))).rejects.toThrow("测试提交断线");
    const saved = loadReadingSession(run.localStorage, 7)!;
    expect(saved.chargeDistillFee).toBe(true);
    expect(saved.pending).toBe("reading");
    const restored = setup(saved);
    restored.poll.mockResolvedValueOnce({ status: "succeeded", output: { planId: "test-plan", distillFeeCharged: 50 } });
    await restored.resumeKnowledgeReading();
    expect(restored.confirm).not.toHaveBeenCalled();
    expect(restored.upload).not.toHaveBeenCalled();
    expect(restored.prepare.mock.calls[0][0]).toMatchObject({ files: saved.files, chargeDistillFee: true });
    expect(restored.get().distillFeeCharged).toBe(50);
  });
  it("已成功版次恢复只查询原页刷新链接，不改attempt或生成", async () => {
    const saved = makeSession();
    for (const page of saved.edition!.pages) saved.pageTasks[page.pageId] = { attempt: 2, status: "succeeded", imageUrl: "expired-link", subjectPosition: "left", infographicTemplateId: "original-template" };
    const run = setup(saved);
    await run.refreshReadingSuccessPages(run.get());
    expect(readingEditionImages(run.get())).toEqual(["image-page-1", "image-page-2", "image-page-3", "image-page-4"]);
    expect(run.status.mock.calls.every((call: any[]) => call[0].attempt === 2 && call[0].subjectPosition === "left" && call[0].infographicTemplateId === "original-template")).toBe(true);
    expect(run.generate).not.toHaveBeenCalled();
    expect(run.confirm).not.toHaveBeenCalled();
    expect(Object.values(run.get().pageTasks).every((task: any) => task.attempt === 2)).toBe(true);
  });
  it("通用job失败但业务reconcile保留旧attempt，不开放重买", async () => {
    const run = setup(makeSession());
    run.status.mockResolvedValueOnce({ status: "running", progressJobId: "original-job" }).mockResolvedValueOnce({ status: "reconcile", progressJobId: "original-job" });
    run.poll.mockResolvedValueOnce({ status: "failed", error: "测试通用失败" });
    await expect(run.withReadingOperation(() => run.renderReadingEdition(run.get()))).rejects.toThrow("尚待核对");
    expect(run.get().pageTasks["page-1"]).toMatchObject({ attempt: 0, status: "pending" });
    expect(run.get().pending).toBe("page");
    expect(run.status.mock.calls[0][0]).toEqual(run.status.mock.calls[1][0]);
    expect(run.generate).not.toHaveBeenCalled();
  });
  it("重试前业务reconcile将旧失败记录恢复为待核对，不升attempt", async () => {
    const saved = makeSession(); saved.pageTasks["page-1"] = { attempt: 3, status: "failed", subjectPosition: "left" };
    const run = setup(saved);
    run.status.mockResolvedValueOnce({ status: "reconcile", progressJobId: "original-job" });
    await expect(run.retryKnowledgeReadingPage()).rejects.toThrow("尚待核对");
    expect(run.get().pageTasks["page-1"]).toMatchObject({ attempt: 3, status: "pending" });
    expect(run.get().pending).toBe("page");
    expect(run.confirm).not.toHaveBeenCalled();
    expect(run.generate).not.toHaveBeenCalled();
  });
  it("业务明确failed后仍须确认费用，确认后才升一次attempt", async () => {
    const saved = makeSession(); saved.pageTasks["page-1"] = { attempt: 3, status: "failed", subjectPosition: "left" };
    const run = setup(saved);
    run.status.mockImplementation(async ({ pageId, attempt }: { pageId: string; attempt: number }) => ({ status: pageId === "page-1" ? attempt === 3 ? "failed" : "not_started" : "succeeded", progressJobId: `job-${pageId}`, imageUrl: pageId === "page-1" ? undefined : `image-${pageId}` }));
    run.confirm.mockReturnValueOnce(false);
    await run.retryKnowledgeReadingPage();
    expect(run.get().pageTasks["page-1"].attempt).toBe(3);
    expect(run.generate).not.toHaveBeenCalled();
    await run.retryKnowledgeReadingPage();
    expect(run.get().pageTasks["page-1"].attempt).toBe(4);
    expect(run.generate).toHaveBeenCalledTimes(1);
    expect(run.generate.mock.calls[0][0].readingPage.attempt).toBe(4);
  });
  it("每页提交自己的正文和冻结版次，已成功页不重跑", async () => {
    const saved = makeSession(); saved.pageTasks["page-1"] = { attempt: 0, status: "succeeded", imageUrl: "existing-image", subjectPosition: "left" };
    const run = setup(saved);
    run.status.mockResolvedValue({ status: "not_started", progressJobId: "test-job" });
    await run.renderReadingEdition(run.get());
    expect(run.generate).toHaveBeenCalledTimes(3);
    expect(run.generate.mock.calls.map((call: Array<{ scriptContext: string }>) => call[0].scriptContext)).toEqual(["第2页独立正文", "第3页独立正文", "第4页独立正文"]);
    expect(run.generate.mock.calls[0][0].readingPage).toEqual({ editionId: "test-edition", pageId: "page-2", attempt: 0 });
  });
});
