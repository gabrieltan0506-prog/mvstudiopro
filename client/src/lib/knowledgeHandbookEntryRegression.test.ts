import { knowledgeCardTrackedJobId, submitKnowledgeCardOnce } from "./knowledgeCardTrackedSubmission";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto, randomUUID } from "node:crypto";
import ts from "typescript";
import { describe, it, expect, vi } from "vitest";
import * as pagination from "../../../shared/knowledgeCardPagination";
import * as source from "../../../shared/knowledgeCardEditableLayout";
import * as identity from "../../../shared/knowledgeCardSourceIdentity";
import * as selection from "../../../shared/knowledgeCardIllustrationSelection";
import * as lifecycle from "./knowledgeIllustrationRun";
import * as handbookVariant from "../../../shared/openaiImageVariant";
import { knowledgeCardPlannedTextPages } from "./knowledgeCardPreflightCounts";
import { knowledgeIllustrationBatchCounts, knowledgeIllustrationBatchSummaryZh, knowledgeIllustrationBatchUserMessage } from "./knowledgeIllustrationBatchCounts";
import { handbookManuscriptNeedsStaging, handbookManuscriptPageBody, stageHandbookManuscript } from "./handbookManuscriptStage";

// 执行生产处理函数，避免只测辅助函数而遗漏按钮之间的真实组合。
// 1119 C0：手册前台流程已原样搬到两个 hook；三份源码拼接后按原标记提取同一段生产代码。
const platform = [
  "../pages/PlatformPage.tsx", "../hooks/useKnowledgeCardDistill.ts", "../hooks/useKnowledgeCardRender.ts",
].map(file => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");
function take(start: string, end: string) {
  const a = platform.indexOf(start), b = platform.indexOf(end, a);
  if (a < 0 || b < a) throw new Error("生产处理函数位置变化，请更新测试提取范围");
  return platform.slice(a, b);
}
function run(raw: string, ctx: any) {
  // 1119：出图 hook 新引用的模块级导入（授权档常量、文字页数、批次计数）按真实实现注入。
  Object.assign(ctx, { ...handbookVariant, knowledgeCardPlannedTextPages, knowledgeIllustrationBatchCounts, knowledgeIllustrationBatchSummaryZh, knowledgeIllustrationBatchUserMessage, handbookManuscriptNeedsStaging, handbookManuscriptPageBody, stageHandbookManuscript }, { customNoteCardsOnly: ctx.customNoteCardsOnly ?? false, setKnowledgeDistillLive: ctx.setKnowledgeDistillLive });
  // 与 useKnowledgeCardRender 内同名辅助一致（1119 C4）：20 万字及以下原样 {markdown}，超过才走摘要
  ctx.handbookStageApi ??= () => ({
    stageChunk: (input: any) => ctx.trpcUtils.client.mvAnalysis.stageKnowledgeCardManuscriptChunk.mutate(input),
    finalize: (input: any) => ctx.trpcUtils.client.mvAnalysis.finalizeKnowledgeCardManuscript.mutate(input),
  });
  ctx.handbookQuoteInput ??= async (markdown: string, distillModel: string) => handbookManuscriptNeedsStaging(markdown)
    ? { manuscriptDigest: await stageHandbookManuscript(markdown, ctx.handbookStageApi()), distillModel }
    : { markdown, distillModel };
  vm.createContext(ctx);
  vm.runInContext(ts.transpileModule(raw, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, ctx);
}
vi.stubGlobal("crypto", webcrypto);
const noop = () => {};
function retryContext(mode: string) {
  const jobs = new Map<string, any>([["original", { status: "failed", output: { knowledgeImageRetry: { version: 1, reason: "refunded" } } }]]);
  let active = "original";
  const events: string[] = [];
  const ctx: any = {
    ...lifecycle, console, crypto: webcrypto, TextEncoder, Set, Map,
    workbenchUserKey: "7", customNoteBusy: false, customNoteImagesRef: { current: [""] }, renderedDraftRef: { current: "原稿" },
    knowledgeCardDraftChanged: () => false, knowledgeCardInflight: [], renderRunIdRef: { current: 1 },
    renderedSettingsRef: { current: { distillModel: "deepseek-v4.1-flash-1017", infographicTemplateId: null } },
    renderedImageJobsRef: { current: ["original"] }, renderedSubmittedImageJobsRef: { current: new Set(["original"]) },
    layoutStudioRef: { current: {
      imageJobs: () => [active],
      beginImageAttempt: async (_old: string, _request: string, id: string) => { active = id; events.push("saved"); },
      attachImage: async () => { if (mode === "attach_failed") throw Error("云稿保存失败"); },
    } },
    setCustomNoteBusy: (value: boolean) => { ctx.customNoteBusy = value; },
    setCustomNoteError: noop, setKnowledgeCardPdfUrl: noop, setCustomNoteProgress: noop, markInflight: noop, setCustomNoteImages: noop,
    knowledgeCardProgressFromRender: () => 0, knowledgeCardCreditsForPageIndex: () => 30,
    trpcUtils: { client: { mvAnalysis: { quoteKnowledgeCardForGeneration: { mutate: async () => ({ billingModel: "deepseek-v4.1-flash-1017" }) } } } },
    window: { confirm: () => true }, knowledgeCardPageTasks: { begin: () => randomUUID(), finish: noop },
    getJob: vi.fn(async (id: string) => { if (!jobs.has(id)) throw Error("(404) Job not found"); return jobs.get(id); }),
    generateCustomNoteOne: vi.fn(async (...args: any[]) => {
      expect(events.at(-1)).toBe("saved");
      const id = args.at(-1).jobId;
      if (mode === "running") jobs.set(id, { status: "running" });
      else if (mode === "attach_failed" || mode === "response_lost") jobs.set(id, { status: "succeeded", output: { imageUrl: "https://test.invalid/image.png" } });
      else if (mode !== "404") jobs.set(id, { status: "failed", output: { knowledgeImageRetry: { version: 1, reason: mode === "refunded" ? "refunded" : "pending" } } });
      if (mode === "attach_failed") return "https://test.invalid/image.png";
      throw Error("请求结果未返回");
    }),
    mapCustomNoteError: (e: Error) => e.message, toast: { error: noop, success: noop, info: noop },
  };
  run(take("  const retryKnowledgeCardPage = async", "\n  /** EPUB") + "\nglobalThis.retry = retryKnowledgeCardPage;", ctx);
  return { ctx, jobs, get active() { return active; } };
}
describe("补图实际入口定向回归 KH-SYNC-02", () => {
  for (const mode of ["pending", "running", "404", "response_lost", "attach_failed"]) it(`${mode}后刷新只恢复最新尝试，不新购`, async () => {
    const f = retryContext(mode);
    await f.ctx.retry(0);
    const attempt = f.active;
    if (mode === "attach_failed") expect(f.ctx.customNoteImagesRef.current[0]).toBe("");
    // 丢弃内存图片任务模拟刷新，只从云稿取回最新尝试。
    f.ctx.renderedImageJobsRef.current = null;
    f.ctx.renderedSubmittedImageJobsRef.current = null;
    await f.ctx.retry(0);
    expect(f.ctx.generateCustomNoteOne).toHaveBeenCalledTimes(1);
    expect(f.ctx.getJob.mock.calls.map((call: any[]) => call[0])).toEqual(["original", attempt]);
  });
  it("最新尝试明确退款后才允许下一次购买", async () => {
    const f = retryContext("refunded"); await f.ctx.retry(0); await f.ctx.retry(0);
    expect(f.ctx.generateCustomNoteOne).toHaveBeenCalledTimes(2);
  });
  it("云稿保存失败时零购买", async () => {
    const f = retryContext("pending"); f.ctx.layoutStudioRef.current.beginImageAttempt = async () => { throw Error("保存失败"); };
    f.ctx.knowledgeCardPageTasks.finish = vi.fn();
    await f.ctx.retry(0); expect(f.ctx.generateCustomNoteOne).not.toHaveBeenCalled();
    expect(f.ctx.knowledgeCardPageTasks.finish).not.toHaveBeenCalled();
  });
});
function entryContext(full: string | null = null) {
  const ctx: any = {
    ...pagination, ...source, ...identity, ...selection, ...lifecycle, console, crypto: webcrypto, TextEncoder, Set, Map, readOpenAiImageVariantPref:()=>"sunburst", useCallback: (fn: any) => fn,
    customNoteBusy: false, customNoteUploadBusy:false, customNoteDistillJobId:"", knowledgeCardInflight: [], customNoteLevelSwitching: false, customNoteKind: "single_page_knowledge_card", customNoteSelectedFileCount: 0,
    knowledgeVerifiedEditionRef:{current:null}, setReadingAdvisorDrafts: vi.fn(), readingControllerRef: {current:null}, readingFullMarkdownRef: {current:""},
    renderedDetailLevelRef: {current:null}, renderedDraftRef: {current:""}, renderedFullManuscriptRef: {current:""},
    customNoteText: "# 新稿B\n\n海洋潮汐受月球引力影响。", customNotePendingFilesRef: { current: [] }, customNoteFullMarkdown: full, customNoteFullMarkdownRef:{current:full}, customNoteCompactMarkdownRef: { current: null }, customNoteDistillPhase: "idle",
    customNoteDistillModel: "deepseek-v4.1-flash-1017", customNoteDetailLevel: "concise", customNoteSubjectPosition: "left", customNoteInfographicTemplateId: null, customNoteRevisionRef: { current: 0 }, workbenchUserKey: "7",
    layoutStudioRef: { current: { prepare: vi.fn(async () => { throw Error("TEST_STOP_AFTER_PREPARE"); }) } },
    customNoteImagesRef: { current: [] }, customNoteStopRenderRef: { current: false }, lastShootingTechniqueBriefRef: { current: "" }, enabledPlatformSkillIds: new Set(), allowBloggerTitle: false,
    knowledgeCardPageTasks: { begin: () => randomUUID(), finish: noop },
    trpcUtils: { client: { mvAnalysis: { quoteKnowledgeCardForGeneration: { mutate: vi.fn(async ({ markdown, distillModel }: any) => ({ ...pagination.planKnowledgeCardPages(markdown, distillModel), billingModel: distillModel })) } } } },
    mapCustomNoteError: (e: Error) => e.message, toast: { error: noop, success: noop, info: noop, message: noop },
    deriveCompactFromFull: async () => ctx.customNoteCompactMarkdownRef.current,
    generateCustomNoteOne: vi.fn(),
    bumpCustomNoteRevision: noop, setCustomNoteFullMarkdown: noop, setCustomNoteCompactMarkdown: noop, setCustomNoteText: noop, setCustomNoteKind: noop,
  };
  for (const name of ["setCustomNoteImageUpper", "setCustomNoteImageLower", "setCustomNoteImages", "setCustomNotePageProgress", "setCustomNoteError", "setCustomOptimizeResult", "setCustomOptimizeSummary", "setCustomNoteProgress", "setCustomNotePartInFlight", "setCustomNoteDistillPhase", "setCustomNoteRendering", "setKnowledgeCardPdfUrl"]) ctx[name] = noop;
  ctx.setCustomNoteBusy = (value: boolean) => { ctx.customNoteBusy = value; };
  run(take("  const handleGenerateCustomNote = async", "\n\n  return { retryKnowledgeCardPage") + take("  const handleAssetGenerateFromText = useCallback(", "\n  const handleGenerateFromOptimizedCopy") + "\nglobalThis.generate = handleGenerateCustomNote; globalThis.asset = handleAssetGenerateFromText;", ctx);
  return ctx;
}
describe("原稿和另一入口 KH-SYNC-03/KH-PRICE-04", () => {
  for (const full of [null, "# 旧稿A\n\n光合作用将光能转化为化学能。"]) it(`直接短稿保持全文配图同源:${full === null ? "首次" : "换稿"}`, async () => {
    const ctx = entryContext(full); await ctx.generate();
    expect(ctx.layoutStudioRef.current.prepare).toHaveBeenCalledTimes(1);
    const received = ctx.layoutStudioRef.current.prepare.mock.calls[0][0];
    expect(received.pages.every((p: any) => p.body.includes("月球引力"))).toBe(true);
    expect(received.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it("合法全文到精华保留完整底稿", async () => {
    const ctx = entryContext("# 月球\n\n月球引力与潮汐的完整说明。");
    ctx.customNoteCompactMarkdownRef.current = ctx.customNoteText; await ctx.generate();
    const received = ctx.layoutStudioRef.current.prepare.mock.calls[0][0];
    expect(received.pages.find((p: any) => p.knowledgeRole === "reading").body).toContain("完整说明");
  });
  it("素材入口经过统一报价和prepare，不绕过确认直接请求单图", async () => {
    const ctx = entryContext(); ctx.customNotePendingFilesRef.current = [{ fileName: "另一任务文件" }]; ctx.customNoteSelectedFileCount = 1;
    await ctx.asset("素材优化稿：月球影响潮汐。", "single_page_knowledge_card");
    expect(ctx.trpcUtils.client.mvAnalysis.quoteKnowledgeCardForGeneration.mutate).toHaveBeenCalledTimes(1);
    expect(ctx.layoutStudioRef.current.prepare).toHaveBeenCalledTimes(1);
    expect(ctx.generateCustomNoteOne).not.toHaveBeenCalled();
    expect(ctx.layoutStudioRef.current.prepare.mock.calls[0][0].pages.every((p: any) => p.body.includes("月球影响潮汐"))).toBe(true);
  });
});
describe("PDF回调来源身份 KH-PAGE-01", () => {
  const callback = take("onPagination={(doc, pagination) => {", "\n        }} /></StableStudioDock>}").slice("onPagination={".length) + "\n}";
  for (const fingerprint of [undefined, "a".repeat(64), "b".repeat(64)]) it(`只接受文档创建时的来源指纹:${fingerprint?.[0] || "旧稿"}`, () => {
    const ctx: any = { knowledgeCardLayoutSourceIdRef: { current: "source-A" }, customNotePaginationKey: "input-B", paginationFingerprint: { key: "input-B", hash: "b".repeat(64) }, setCustomNotePagination: vi.fn() };
    run("globalThis.callback = " + callback, ctx);
    ctx.callback({ sourceId: "source-A", publication: { inputFingerprint: fingerprint } }, { imagePages: 2, totalPages: 17 });
    expect(ctx.setCustomNotePagination.mock.calls.length).toBe(fingerprint === "b".repeat(64) ? 1 : 0);
  });
});

import { KNOWLEDGE_CARD_DETAIL_LEVEL_LABEL_ZH } from "../../../shared/knowledgeCardDistillSections";
import { KNOWLEDGE_CARD_SUBJECT_POSITION_LABEL_ZH } from "../../../shared/knowledgeCardSubjectPosition";
import { knowledgeCardRecordedModelLabel } from "../../../shared/knowledgeCardDistillModels";
import { assertKnowledgeCardConfirmedPrice } from "../../../server/services/knowledgeCardPricing";
it("素材按钮到实际单图请求保持同一报价和一次确认 KH-PRICE-04", async () => {
  const ctx = entryContext();
  Object.assign(ctx, {
    KNOWLEDGE_CARD_DETAIL_LEVEL_LABEL_ZH, KNOWLEDGE_CARD_SUBJECT_POSITION_LABEL_ZH, knowledgeCardRecordedModelLabel,
    knowledgeCardRenderConcurrency: (n: number) => Math.min(n, 32), customNoteInfographicLabelZh: "", knowledgeCardProgressFromRender: () => 50,
    askKnowledgeCardPreflight: vi.fn(async () => true), markInflight: noop, setKnowledgeCardInflight: noop,
    newPlatformCompositeProgressJobId: randomUUID, extractInfographicSubjectFromUserCopy: () => "素材稿",
    readOpenAiImageVariantPref: () => "standard", COMPOSITE_SHEET_IMAGE_PROMPT_TRANSLATOR: "gpt54",
    generateCustomNoteMutation: { mutateAsync: vi.fn(async (input: any) => {
      expect(ctx.askKnowledgeCardPreflight).toHaveBeenCalledTimes(1);
      assertKnowledgeCardConfirmedPrice(input.distillModel, input.notePageIndex, input.confirmedPageCredits);
      // 1119 C1：手册请求固定授权档，不读前台偏好（偏好桩返回非法值也不影响）
      expect(input.openaiImageVariant).toBe("sunburst");
      expect(input.scriptContext).toBe("素材正文：月球影响潮汐。");
      return { imageUrl: "https://test.invalid/image.png" };
    }) },
  });
  for (const name of ["renderRunIdRef", "renderedSettingsRef", "renderedImageJobsRef", "renderedSubmittedImageJobsRef", "renderedDraftRef", "renderedFullManuscriptRef", "renderedDetailLevelRef", "knowledgeCardLayoutSourceIdRef"]) ctx[name] = { current: name === "renderRunIdRef" ? 0 : null };
  ctx.knowledgeCardPageTasks.assertLive = noop;
  ctx.layoutStudioRef.current.prepare = vi.fn(async () => ({ documentId: "doc", maxCredits: 3 }));
  ctx.layoutStudioRef.current.start = vi.fn(async () => {});
  run(take("  const generateCustomNoteOne = async (", "\n  const mapCustomNoteError"), ctx);
  await ctx.asset("素材正文：月球影响潮汐。", "single_page_knowledge_card");
  expect(ctx.generateCustomNoteMutation.mutateAsync).toHaveBeenCalledTimes(1);
  expect(ctx.generateCustomNoteMutation.mutateAsync.mock.calls[0][0].confirmedPageCredits).toBe(30);
  expect(ctx.layoutStudioRef.current.start).toHaveBeenCalledTimes(1);
});

import { layoutFromSource, layoutLibrarySchema } from "../../../shared/editableLayout";
describe("真实云稿句柄保存与恢复 KH-SYNC-02", () => {
  const studio = readFileSync(new URL("../components/platform/EditableLayoutStudio.tsx", import.meta.url), "utf8");
  const methods = studio.slice(studio.indexOf("    imageJobs("), studio.indexOf("    async start("));
  function setup() {
    const doc = layoutFromSource(source.synchronizedKnowledgeCardSource({ owner: "7", sourceId: "sync", inputFingerprint: "a".repeat(64), fullMarkdown: "完整正文", illustrationMarkdown: "配图正文", detailLevel: "full", imageJobIds: ["original"] }));
    doc.publication!.synchronizedStarted = true;
    const ctx: any = { planKnowledgeCardPages: pagination.planKnowledgeCardPages, layoutLibrarySchema, Object, Promise, setTimeout,
      locked: { current: false }, alive: { current: true }, cloudReady: true,
      current: { current: { library: { version: 1, owner: "7", documents: [doc] }, generation: "1" } },
      saveMutation: { mutateAsync: vi.fn(async () => ({ generation: "2" })) },
      setSynchronizedRun: noop, setAutoPublicationId: noop, setAutoStartToken: noop, setOpen: noop,
    };
    ctx.install = (next: any) => { ctx.current.current = next; };
    // 根因（1119）：生产方法改经 cloudSave 统一入口保存，旧夹具只给了 saveMutation，于是报 cloudSave is not defined。
    // 这里一并提取真实的 cloudSave，保留「不完整库拒绝保存」等原有保护。
    Object.assign(ctx, { partialLibrary: { current: false }, legacyPresent: { current: false }, legacyInMemory: { current: false }, legacyKey: "test", localStorage: { removeItem: noop } });
    const cloudSave = studio.slice(studio.indexOf("  const cloudSave = async"), studio.indexOf("\n  useEffect(", studio.indexOf("  const cloudSave = async")));
    run(cloudSave + "\nglobalThis.handle = {" + methods + "};", ctx);
    return ctx;
  }
  it("条件保存先于读取当前尝试，第二次失败重试仍绑定原始页", async () => {
    const ctx = setup();
    const first = randomUUID(), second = randomUUID();
    const firstJob = await lifecycle.knowledgeIllustrationJobId("7", first), secondJob = await lifecycle.knowledgeIllustrationJobId("7", second);
    await ctx.handle.beginImageAttempt("original", first, firstJob);
    expect(ctx.handle.imageJobs("配图正文", "deepseek-v4.1-flash-1017", null)).toEqual([firstJob]);
    expect(ctx.saveMutation.mutateAsync.mock.calls[0][0].expectedGeneration).toBe("1");
    await ctx.handle.beginImageAttempt(firstJob, second, secondJob);
    await ctx.handle.attachImage(secondJob, secondJob, true);
    const pub = ctx.current.current.library.documents[0].publication;
    expect(pub.imageAttempts.original.jobId).toBe(secondJob);
    expect(pub.imageReplacements).toEqual({ original: secondJob });
    expect(pub.inputFingerprint).toBe("a".repeat(64));
    expect(ctx.locked.current).toBe(false);
  });
  it("保存回包丢失不安装猜测版本，旧generation再次提交仍由云端拒绝", async () => {
    const ctx = setup(); ctx.saveMutation.mutateAsync = vi.fn(async () => { throw Error("版本冲突或回包丢失"); });
    await expect(ctx.handle.beginImageAttempt("original", randomUUID(), "kc_attempt")).rejects.toThrow("版本冲突");
    expect(ctx.current.current.generation).toBe("1");
    expect(ctx.handle.imageJobs("配图正文", "deepseek-v4.1-flash-1017", null)).toEqual(["original"]);
    expect(ctx.locked.current).toBe(false);
  });
});
it("素材入口在途时不覆盖正文或清理底稿", async () => {
  const ctx = entryContext("旧底稿"); ctx.customNoteBusy = true; ctx.setCustomNoteText = vi.fn(); ctx.setCustomNoteFullMarkdown = vi.fn();
  await ctx.asset("新稿", "single_page_knowledge_card");
  expect(ctx.setCustomNoteText).not.toHaveBeenCalled(); expect(ctx.setCustomNoteFullMarkdown).not.toHaveBeenCalled();
});

import { suggestKnowledgeCardMinSections } from "../../../shared/knowledgeCardDistillSections";
import { knowledgeCardDistillFeeForModel } from "../../../shared/knowledgeCardDistillModels";
it("长文选择直接出图仍以当前原文作为完整底稿 KH-SYNC-03", async () => {
  const ctx = entryContext("旧全文"); ctx.customNoteText = "月球引力影响潮汐。".repeat(1300);
  Object.assign(ctx, { suggestKnowledgeCardMinSections, knowledgeCardDistillFeeForModel, window: { confirm: vi.fn(() => false) } });
  await ctx.generate();
  expect(ctx.layoutStudioRef.current.prepare).toHaveBeenCalledTimes(1);
  const received = ctx.layoutStudioRef.current.prepare.mock.calls[0][0];
  expect(received.body).toBe(ctx.customNoteText);
  expect(received.pages.filter((p: any) => p.knowledgeRole === "reading").every((p: any) => !p.body.includes("旧全文"))).toBe(true);
});
it("采用优化稿先失效旧全文并使用新文字 KH-SYNC-03", async () => {
  const ctx = entryContext("旧全文"); ctx.customOptimizeResult = "新优化稿：月球引力。";
  ctx.setCustomNoteFullMarkdown = vi.fn(); ctx.setCustomNoteCompactMarkdown = vi.fn();
  run(take("  const handleGenerateFromOptimizedCopy = useCallback(", "\n  const ") + "\nglobalThis.optimized = handleGenerateFromOptimizedCopy;", ctx);
  await ctx.optimized("single_page_knowledge_card");
  expect(ctx.setCustomNoteFullMarkdown).toHaveBeenCalledWith(null);
  expect(ctx.setCustomNoteCompactMarkdown).toHaveBeenCalledWith(null);
  expect(ctx.layoutStudioRef.current.prepare.mock.calls[0][0].body).toBe(ctx.customOptimizeResult);
});


describe("两档同稿只改配图 KH-SAME-MANUSCRIPT-01", () => {
  const full = "# 完整书稿\n\n## 主线\n主要事件。\n\n## 末章\n未配图的完整说明必须保留。";
  const compact = "# 重点配图\n\n## 主线\n主要事件。";
  for (const level of ["full", "concise"]) it(`${level}报价与顾问分离且正文逐字保留`, async () => {
    const ctx = entryContext(full);
    ctx.customNoteText = full; ctx.customNoteDetailLevel = level;
    ctx.customNoteCompactMarkdownRef.current = compact;
    ctx.setCustomNoteText = vi.fn();
    await ctx.generate();
    expect(ctx.setCustomNoteText).not.toHaveBeenCalled();
    expect(ctx.trpcUtils.client.mvAnalysis.quoteKnowledgeCardForGeneration.mutate.mock.calls[0][0].markdown).toBe(level === "concise" ? compact : full);
    const received = ctx.layoutStudioRef.current.prepare.mock.calls[0][0];
    expect(received.body).toBe(full);
    expect(received.pages.filter((p: any) => p.knowledgeRole === "reading" || level === "full").map((p: any) => p.body).join("\n")).toContain("未配图的完整说明必须保留");
  });
  it("重点选图失败时保留全文且不报价不出图", async () => {
    const ctx = entryContext(full); ctx.customNoteText = full;
    ctx.deriveCompactFromFull = async () => { throw Error("选图失败"); };
    await ctx.generate();
    expect(ctx.customNoteText).toBe(full);
    expect(ctx.trpcUtils.client.mvAnalysis.quoteKnowledgeCardForGeneration.mutate).not.toHaveBeenCalled();
    expect(ctx.generateCustomNoteOne).not.toHaveBeenCalled();
  });
});

it("缺全文的旧精华备份拒绝新整册且不清图片", async () => {
 const ctx=entryContext();ctx.renderedDetailLevelRef.current="concise";ctx.renderedDraftRef.current=ctx.customNoteText;
 ctx.renderedFullManuscriptRef.current="";ctx.setCustomNoteImages=vi.fn();ctx.setCustomNoteImageUpper=vi.fn();
 await ctx.generate();expect(ctx.setCustomNoteImages).not.toHaveBeenCalled();expect(ctx.setCustomNoteImageUpper).not.toHaveBeenCalled();expect(ctx.layoutStudioRef.current.prepare).not.toHaveBeenCalled();
});

it("已成功统稿不被同步顾问状态查询失败阻断",async()=>{
 const full="## 完整稿\n最后一句仍然保留。",update=vi.fn(async()=>{throw Error("顾问状态暂时不可用");});
 const requestId=randomUUID(),trackedJobId=await knowledgeCardTrackedJobId("1","knowledge_card_distill",requestId);
 const ctx:any={AbortController,readingControllerRef:{current:null},setReadingAdvisorDrafts:noop,knowledgePollingRef:{current:null},knowledgeCardTrackedJobId,submitKnowledgeCardOnce,workbenchUserKey:"1",customNoteTrackedRequestRef:{current:null},customNoteFollowOnlyJobRef:{current:""},startReadingAdvisor:()=>({update}),readingFullMarkdownRef:{current:""},bumpCustomNoteRevision:noop,customNoteDistillModel:"deepseek-v4.1-flash-1017",customNoteUploadStopRef:{current:false},knowledgeCardPageTasks:{begin:()=>requestId,finish:noop,assertLive:noop},prepareKnowledgeCardCopyMutation:{mutateAsync:async()=>({isAsync:true,progressJobId:trackedJobId,estimatedChunks:1})},pollJobUntilTerminal:async()=>({status:"succeeded",output:{distilledMarkdown:full,readingPreparation:{jobId:"kc_original",documentId:randomUUID(),batches:1,ready:[0]}}}),knowledgeCardProgressFromDistill:(n:number)=>n};
 for(const name of ["setCustomNoteProgress","setCustomNoteFullMarkdown","setCustomNotePreparedModel","setCustomNoteCompactMarkdown","setKnowledgeCardEpubPdfs","setCustomNoteCancelRequested","setCustomNoteDistillJobId","setReadingAdvisorStatus","setCustomNoteUploadStatus"])ctx[name]=vi.fn();
 run(take("  const runKnowledgeCardDistill = async", "\n\n  return { customNotePaginationKey")+"\nglobalThis.distill=runKnowledgeCardDistill;",ctx);
 expect(await ctx.distill({sourceText:"原始全文"})).toBe(full);expect(ctx.readingFullMarkdownRef.current).toBe(full);expect(update).not.toHaveBeenCalled();
});
it('保有完整统稿回执时取消过报价也不再提炼长文',async()=>{
 const full='完整原文与结尾。'.repeat(1600),ctx=entryContext(full);
 ctx.customNoteText=full;ctx.customNoteDetailLevel='full';ctx.customNoteDistillPhase='idle';
 ctx.window={confirm:vi.fn(()=>true)};ctx.runKnowledgeCardDistill=vi.fn(async()=>{throw Error('不应重复提炼');});
 await ctx.generate();expect(ctx.runKnowledgeCardDistill).not.toHaveBeenCalled();expect(ctx.window.confirm).not.toHaveBeenCalled();
 expect(ctx.layoutStudioRef.current.prepare.mock.calls[0][0].body).toBe(full);
});

it("读档连接恢复时另一生成入口拒绝重复创建",async()=>{
 const ctx=entryContext("原稿");ctx.customNoteDistillJobId="kc_original";ctx.customNoteUploadBusy=false;
 await ctx.generate();expect(ctx.layoutStudioRef.current.prepare).not.toHaveBeenCalled();expect(ctx.generateCustomNoteOne).not.toHaveBeenCalled();
});

it('手册正式生成入口只准备PDF，不自动发起PPTX规划',async()=>{
 const ctx=entryContext();await ctx.generate();
 expect(ctx.layoutStudioRef.current.prepare).toHaveBeenCalledTimes(1);
 expect(ctx.layoutStudioRef.current.prepare.mock.calls[0][3].preparePresentation).toBe(false);
 expect(ctx.generateCustomNoteOne).not.toHaveBeenCalled();
});

describe("1119 C1/C2/C3 生成入口", () => {
  function renderContext() {
    const ctx = entryContext();
    Object.assign(ctx, {
      KNOWLEDGE_CARD_DETAIL_LEVEL_LABEL_ZH, KNOWLEDGE_CARD_SUBJECT_POSITION_LABEL_ZH, knowledgeCardRecordedModelLabel,
      knowledgeCardRenderConcurrency: (n: number) => Math.min(n, 32), customNoteInfographicLabelZh: "", knowledgeCardProgressFromRender: () => 50,
      askKnowledgeCardPreflight: vi.fn(async () => true), markInflight: noop, setKnowledgeCardInflight: noop,
      newPlatformCompositeProgressJobId: randomUUID, extractInfographicSubjectFromUserCopy: () => "稿",
      COMPOSITE_SHEET_IMAGE_PROMPT_TRANSLATOR: "gpt54",
      generateCustomNoteMutation: { mutateAsync: vi.fn(async () => ({ imageUrl: "https://test.invalid/image.png" })) },
    });
    delete ctx.readOpenAiImageVariantPref;
    for (const name of ["renderRunIdRef", "renderedSettingsRef", "renderedImageJobsRef", "renderedSubmittedImageJobsRef", "renderedDraftRef", "renderedFullManuscriptRef", "renderedDetailLevelRef", "knowledgeCardLayoutSourceIdRef"]) ctx[name] = { current: name === "renderRunIdRef" ? 0 : null };
    ctx.knowledgeCardPageTasks.assertLive = noop;
    ctx.layoutStudioRef.current.prepare = vi.fn(async () => ({ documentId: "doc", maxCredits: 3 }));
    ctx.layoutStudioRef.current.start = vi.fn(async () => {});
    run(take("  const generateCustomNoteOne = async (", "\n  const mapCustomNoteError"), ctx);
    return ctx;
  }
  it("确认弹窗带图片页数、文字页数、档名与仅 debug 用的模型名；请求只带授权档", async () => {
    const ctx = renderContext();
    await ctx.generate();
    const summary = ctx.askKnowledgeCardPreflight.mock.calls[0][0];
    expect(summary.pageCount).toBe(1);
    expect(typeof summary.textPageCount).toBe("number");
    expect(summary.imageTierZh).toBe(handbookVariant.HANDBOOK_IMAGE_TIER_LABEL_ZH);
    expect(summary.imageTierZh).not.toMatch(/gpt|sunburst|flare|openai|evolink/i);
    expect(summary.imageModelDebug).toBe("gpt-image-2.6-sunburst");
    expect(ctx.generateCustomNoteMutation.mutateAsync.mock.calls[0][0].approvedImageModel).toBe(summary.imageModelDebug);
    expect(ctx.generateCustomNoteMutation.mutateAsync.mock.calls[0][0].openaiImageVariant).toBe("sunburst");
    expect(ctx.layoutStudioRef.current.start).toHaveBeenCalledTimes(1);
  });
  it("确认弹窗点「返回修改」：零出图请求、不启动", async () => {
    const ctx = renderContext(); ctx.askKnowledgeCardPreflight = vi.fn(async () => false);
    await ctx.generate();
    expect(ctx.askKnowledgeCardPreflight).toHaveBeenCalledTimes(1);
    expect(ctx.generateCustomNoteMutation.mutateAsync).not.toHaveBeenCalled();
    expect(ctx.layoutStudioRef.current.start).not.toHaveBeenCalled();
  });
  it("只出卡片：prepare 带 cardsOnly，确认后 start 授权额为 0（只存云稿），仍逐页出图", async () => {
    const ctx = renderContext(); ctx.customNoteCardsOnly = true;
    ctx.layoutStudioRef.current.prepare = vi.fn(async () => ({ documentId: "doc", maxCredits: 0 }));
    await ctx.generate();
    expect(ctx.layoutStudioRef.current.prepare.mock.calls[0][3]).toMatchObject({ cardsOnly: true, preparePresentation: false });
    expect(ctx.askKnowledgeCardPreflight.mock.calls[0][0]).toMatchObject({ cardsOnly: true, textPageCount: 0 });
    expect(ctx.layoutStudioRef.current.start).toHaveBeenCalledWith("doc", 0);
    expect(ctx.layoutStudioRef.current.start.mock.invocationCallOrder[0]).toBeLessThan(ctx.generateCustomNoteMutation.mutateAsync.mock.invocationCallOrder[0]);
    expect(ctx.generateCustomNoteMutation.mutateAsync).toHaveBeenCalledTimes(1);
  });
  it("只出卡片：确认弹窗取消→不调用 start（云稿不写「已开始」），零出图", async () => {
    const ctx = renderContext(); ctx.customNoteCardsOnly = true; ctx.askKnowledgeCardPreflight = vi.fn(async () => false);
    await ctx.generate();
    expect(ctx.layoutStudioRef.current.start).not.toHaveBeenCalled();
    expect(ctx.generateCustomNoteMutation.mutateAsync).not.toHaveBeenCalled();
  });
  it("批次错误带分项计数时，失败提示如实报已完成页而非「未生成」", () => {
    const counts = knowledgeIllustrationBatchCounts(Object.assign(new Error("部分页失败"), { counts: { succeeded: 3, failed: 1, pendingVerification: 1, notDispatched: 2 } }));
    expect(counts).toMatchObject({ succeeded: 3, failed: 1, pending: 1, notDispatched: 2 });
    expect(knowledgeIllustrationBatchSummaryZh(counts!)).toContain("已完成 3 页");
    expect(knowledgeIllustrationBatchCounts(new Error("旧版普通错误"))).toBeNull();
  });
  // 线 D 的 KnowledgeIllustrationBatchError（鸭子类型）：Error + summary{succeeded,failed,unknown,notDispatched,stoppedBy}
  const batchError = (message: string, summary: Record<string, unknown>) => Object.assign(new Error(message), { summary: { total: 4, dispatched: 4, ...summary } });
  function batchContext(behaviour: (ctx: any) => Promise<void>) {
    const ctx = renderContext();
    ctx.toast = { error: vi.fn(), success: vi.fn(), info: vi.fn(), message: vi.fn() };
    ctx.setCustomNoteError = vi.fn();
    ctx.mapCustomNoteError = vi.fn((e: Error) => e.message);
    const progress: any[] = [];
    ctx.setCustomNoteProgress = (v: any) => progress.push(typeof v === "function" ? v({ status: "running", percent: 40 }) : v);
    ctx.runKnowledgeIllustrationBatch = vi.fn(async () => behaviour(ctx));
    return { ctx, progress };
  }
  it("批次错误（服务端新形态）：用户句只由计数拼成，不带引擎名/401，也不交给脱敏", async () => {
    const { ctx, progress } = batchContext(async () => { throw batchError("配图完成 2/4 页：OpenAI generations HTTP 401: invalid api key (gpt-image-2.6-sunburst)", { succeeded: 2, failed: 1, unknown: 1, notDispatched: 0, stoppedBy: null }); });
    await ctx.generate();
    const shown = ctx.toast.error.mock.calls[0][0] as string;
    expect(shown).toContain("已完成 2 页");
    expect(shown).toContain("1 页结果待核实（不会自动重新购买）");
    expect(shown).not.toMatch(/openai|gpt|sunburst|401|api key/i);
    expect(ctx.setCustomNoteError.mock.calls.at(-1)[0]).toBe(shown);
    expect(ctx.mapCustomNoteError).not.toHaveBeenCalled();
    expect(progress.at(-1).status).toBe("failed");
  });
  it("用户按停止且有页失败（非整批必败）：走「已停止」并报分项计数", async () => {
    const { ctx, progress } = batchContext(async (c) => { c.customNoteStopRenderRef.current = true; throw batchError("配图完成 1/4 页：EvoLink 失败", { succeeded: 1, failed: 1, unknown: 1, notDispatched: 1, stoppedBy: "inactive" }); });
    await ctx.generate();
    expect(progress.at(-1).status).toBe("stopped");
    expect(progress.at(-1).error).toContain("1 页结果待核实");
    expect(ctx.toast.message.mock.calls[0][0]).toContain("已停止出图");
    expect(ctx.toast.message.mock.calls[0][0]).not.toMatch(/evolink/i);
    expect(ctx.toast.error).not.toHaveBeenCalled();
  });
  it("用户按停止但批次因整批必败停止：仍报失败（不被说成用户停止）", async () => {
    const { ctx, progress } = batchContext(async (c) => { c.customNoteStopRenderRef.current = true; throw batchError("x", { succeeded: 0, failed: 1, unknown: 0, notDispatched: 3, stoppedBy: "batch_fatal" }); });
    await ctx.generate();
    expect(progress.at(-1).status).toBe("failed");
    expect(ctx.toast.error.mock.calls[0][0]).toContain("已停止派发新页");
  });
  it("旧版批次（首错即抛普通错误）：按原逻辑报失败并经 mapCustomNoteError", async () => {
    const { ctx, progress } = batchContext(async (c) => { c.customNoteStopRenderRef.current = true; throw new Error("旧版首个错误"); });
    await ctx.generate();
    expect(progress.at(-1).status).toBe("failed");
    expect(ctx.mapCustomNoteError).toHaveBeenCalledTimes(1);
    expect(ctx.toast.error.mock.calls[0][0]).toContain("旧版首个错误");
  });
  it("旧版批次（void 返回）+ 用户停止：仍按已出页数报「已停止」", async () => {
    const { ctx, progress } = batchContext(async (c) => { c.customNoteStopRenderRef.current = true; });
    await ctx.generate();
    expect(progress.at(-1).status).toBe("stopped");
    expect(ctx.toast.error).not.toHaveBeenCalled();
  });
});

describe("1119 C4 生成入口：大稿只带摘要与本页正文", () => {
  function oneContext() {
    const sent: any[] = [];
    const ctx: any = { console, crypto: webcrypto, TextEncoder, Set, Map, ...pagination, knowledgeCardPageTasks: { assertLive: noop, begin: () => randomUUID(), finish: noop },
      newPlatformCompositeProgressJobId: randomUUID, extractInfographicSubjectFromUserCopy: () => "稿", COMPOSITE_SHEET_IMAGE_PROMPT_TRANSLATOR: "gpt54",
      customNoteDistillModel: "deepseek-v4.1-flash-1017", customNoteSubjectPosition: "left", customNoteInfographicTemplateId: null, enabledPlatformSkillIds: new Set(), allowBloggerTitle: false,
      generateCustomNoteMutation: { mutateAsync: vi.fn(async (input: any) => { sent.push(input); return { imageUrl: "https://test.invalid/x.png" }; }) },
      trpcUtils: { client: { mvAnalysis: { stageKnowledgeCardManuscriptChunk: { mutate: vi.fn(async () => ({ stored: true })) }, finalizeKnowledgeCardManuscript: { mutate: vi.fn(async () => ({})) } } } } };
    run(take("  const generateCustomNoteOne = async (", "\n  const mapCustomNoteError") + "\nglobalThis.one = generateCustomNoteOne;", ctx);
    return { ctx, sent };
  }
  const snap = { distillModel: "deepseek-v4.1-flash-1017", billingModel: "deepseek-v4.1-flash-1017", subjectPosition: "left", infographicTemplateId: null };
  it("15 万字：请求仍带整份 scriptContext，无摘要字段，不上传", async () => {
    const { ctx, sent } = oneContext();
    const text = "## 一\n" + "光合作用。".repeat(30_000);
    await ctx.one(text, "single_page_knowledge_card", undefined, { index: 1, total: 1 }, "openai", snap, { requestId: randomUUID(), jobId: "kc_a" });
    expect(sent[0].scriptContext).toBe(text);
    expect(sent[0]).not.toHaveProperty("manuscriptDigest");
    expect(sent[0]).not.toHaveProperty("pageBody");
    expect(ctx.trpcUtils.client.mvAnalysis.stageKnowledgeCardManuscriptChunk.mutate).not.toHaveBeenCalled();
  });
  it("超过 20 万字：先暂存，再只带摘要与本页正文；无任何字段超过 20 万字", async () => {
    const { ctx, sent } = oneContext();
    const text = Array.from({ length: 400 }, (_, i) => `## 第${i + 1}节\n${"细胞呼吸释放能量。".repeat(70)}`).join("\n\n");
    expect(text.length).toBeGreaterThan(200_000);
    const page = pagination.planKnowledgeCardPages(text).pages[1];
    await ctx.one(text, "single_page_knowledge_card", undefined, { index: 2, total: pagination.planKnowledgeCardPages(text).pageCount }, "openai", snap, { requestId: randomUUID(), jobId: "kc_b" });
    expect(sent[0]).not.toHaveProperty("scriptContext");
    expect(sent[0].manuscriptDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(sent[0].pageBody).toBe(page);
    for (const v of Object.values(sent[0])) if (typeof v === "string") expect(v.length).toBeLessThanOrEqual(200_000);
    expect(ctx.trpcUtils.client.mvAnalysis.finalizeKnowledgeCardManuscript.mutate).toHaveBeenCalledTimes(1);
  });
});

describe("读档档位下拉：普通用户只见档名（1119 复审）", () => {
  it("下拉选项与「当前稿件」在非 debug 时经 knowledgeCardPublicTierLabel，且档名不含任何模型/供应商名", async () => {
    const { KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS, knowledgeCardRecordedModelLabel: label } = await import("../../../shared/knowledgeCardDistillModels");
    const { knowledgeCardPublicTierLabel } = await import("../components/platform/KnowledgeCardPreflight");
    for (const o of KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS) {
      expect(knowledgeCardPublicTierLabel(o.labelZh)).not.toMatch(/deepseek|glm|gpt|gemini|flash|openai|evolink/i);
      expect(knowledgeCardPublicTierLabel(label(o.id))).not.toMatch(/deepseek|glm|gpt|gemini|flash/i);
    }
    expect(knowledgeCardPublicTierLabel(label("some-old-model-id"))).not.toContain("some-old-model-id");
    const page = readFileSync(new URL("../pages/PlatformPage.tsx", import.meta.url), "utf8");
    const select = page.slice(page.indexOf("KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS.map((o) =>"), page.indexOf("选择框用于下次读档"));
    expect(select).toContain("canShowPlatformDebug && debugMode ? o.labelZh : knowledgeCardPublicTierLabel(o.labelZh)");
    expect(select).toContain("knowledgeCardPublicTierLabel(knowledgeCardRecordedModelLabel(customNotePreparedModel))");
    expect(select).not.toMatch(/\{o\.labelZh\} ·/);
  });
});
