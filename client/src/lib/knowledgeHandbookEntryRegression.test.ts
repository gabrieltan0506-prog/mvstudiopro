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

// 执行生产处理函数，避免只测辅助函数而遗漏按钮之间的真实组合。
const platform = readFileSync(new URL("../pages/PlatformPage.tsx", import.meta.url), "utf8");
function take(start: string, end: string) {
  const a = platform.indexOf(start), b = platform.indexOf(end, a);
  if (a < 0 || b < a) throw new Error("生产处理函数位置变化，请更新测试提取范围");
  return platform.slice(a, b);
}
function run(raw: string, ctx: any) {
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
    customNoteBusy: false, knowledgeCardInflight: [], customNoteLevelSwitching: false, customNoteKind: "single_page_knowledge_card", customNoteSelectedFileCount: 0,
    setReadingAdvisorDrafts: vi.fn(), readingControllerRef: {current:null}, readingFullMarkdownRef: {current:""},
    renderedDetailLevelRef: {current:null}, renderedDraftRef: {current:""}, renderedFullManuscriptRef: {current:""},
    customNoteText: "# 新稿B\n\n海洋潮汐受月球引力影响。", customNotePendingFilesRef: { current: [] }, customNoteFullMarkdown: full, customNoteCompactMarkdownRef: { current: null }, customNoteDistillPhase: "idle",
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
  run(take("  const handleGenerateCustomNote = async", "\n  const handleAssetDeepOptimize") + take("  const handleAssetGenerateFromText = useCallback(", "\n  const handleGenerateFromOptimizedCopy") + "\nglobalThis.generate = handleGenerateCustomNote; globalThis.asset = handleAssetGenerateFromText;", ctx);
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
    KNOWLEDGE_CARD_RENDER_CONCURRENCY: 4, customNoteInfographicLabelZh: "", knowledgeCardProgressFromRender: () => 50,
    askKnowledgeCardPreflight: vi.fn(async () => true), markInflight: noop, setKnowledgeCardInflight: noop,
    newPlatformCompositeProgressJobId: randomUUID, extractInfographicSubjectFromUserCopy: () => "素材稿",
    readOpenAiImageVariantPref: () => "standard", COMPOSITE_SHEET_IMAGE_PROMPT_TRANSLATOR: "gpt54",
    generateCustomNoteMutation: { mutateAsync: vi.fn(async (input: any) => {
      expect(ctx.askKnowledgeCardPreflight).toHaveBeenCalledTimes(1);
      assertKnowledgeCardConfirmedPrice(input.distillModel, input.notePageIndex, input.confirmedPageCredits);
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
    run("globalThis.handle = {" + methods + "};", ctx);
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
 const ctx:any={startReadingAdvisor:()=>({update}),readingFullMarkdownRef:{current:""},bumpCustomNoteRevision:noop,customNoteDistillModel:"deepseek-v4.1-flash-1017",customNoteUploadStopRef:{current:false},knowledgeCardPageTasks:{begin:()=>randomUUID(),finish:noop,assertLive:noop},prepareKnowledgeCardCopyMutation:{mutateAsync:async()=>({isAsync:true,progressJobId:"kc_original",estimatedChunks:1})},pollJobUntilTerminal:async()=>({status:"succeeded",output:{distilledMarkdown:full,readingPreparation:{jobId:"kc_original",documentId:randomUUID(),batches:1,ready:[0]}}}),knowledgeCardProgressFromDistill:(n:number)=>n};
 for(const name of ["setCustomNoteProgress","setCustomNoteFullMarkdown","setCustomNotePreparedModel","setCustomNoteCompactMarkdown","setKnowledgeCardEpubPdfs","setCustomNoteCancelRequested","setCustomNoteDistillJobId","setReadingAdvisorStatus"])ctx[name]=vi.fn();
 run(take("  const runKnowledgeCardDistill = async", "\n  /**\n   * 终止后台读档")+"\nglobalThis.distill=runKnowledgeCardDistill;",ctx);
 expect(await ctx.distill({sourceText:"原始全文"})).toBe(full);expect(ctx.readingFullMarkdownRef.current).toBe(full);expect(ctx.setReadingAdvisorStatus).toHaveBeenCalled();
});
