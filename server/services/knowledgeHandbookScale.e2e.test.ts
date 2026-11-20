/**
 * 图文知识手册「出图之后的后半程」零成本、多规模端到端演练（1121 夜）。
 * 逐章整理（审校批次）→ 统稿（零调用汇总 + 最终篇幅压缩）→ 整册排版（分组并行）→ 导出输入/整册视图 → 云稿保存。
 * 只替身两样东西：模型（deps.post）与对象存储（./gcs 换成内存桶）。其余——云稿读写与保存校验、权限核验、
 * 配图任务解析、批次划分、预算、压缩分组、排版分组、合并与回执核对——全部走正式代码。
 * 测试数据一律经正式 schema（editableLayoutSchema / layoutLibrarySchema）解析生成，结构与今晚线上稿一致：
 * detailLevel=full、readingContract=image-primary-v1、reviewBatchMode=ready-images、每页 role=illustration 且有 imageJobId、
 * publication.readingBudgetVersion=2、parallel.family=glm。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const bucket = vi.hoisted(() => ({ objects: new Map<string, { buffer: Buffer; generation: number }>(), jobs: new Map<string, any>(), seq: 0 }));
vi.mock("../jobs/repository", async importOriginal => ({ ...await importOriginal<any>(), getJobByIdStrict: vi.fn(async (id: string) => bucket.jobs.get(id) || null) }));
vi.mock("./postProdMediaSource", async importOriginal => ({ ...await importOriginal<any>(),
  loadSucceededJobOutputSources: async () => ({ objects: new Set(), urls: new Set() }),
  loadSucceededJobOutputSourcesForJobs: async () => ({ objects: new Set(), urls: new Set() }),
  resolveRegisteredPostProdMediaSource: async ({ source }: { source: string }) => source.replace("https://storage.googleapis.com/", "gs://") }));
vi.mock("./gcs", async importOriginal => {
  const name = (uri: string) => uri.replace(/^gs:\/\/test\//, "");
  const stat = async ({ gcsUri }: { gcsUri: string }) => {
    const v = bucket.objects.get(name(gcsUri));
    if (!v) throw new Error("gcs_stat_failed:404");
    return { bucket: "test", objectName: name(gcsUri), generation: String(v.generation), byteLength: v.buffer.length };
  };
  const upload = async (p: { objectName: string; buffer: Buffer; ifGenerationMatch?: string }) => {
    const old = bucket.objects.get(p.objectName);
    if (p.ifGenerationMatch !== undefined && p.ifGenerationMatch !== String(old?.generation ?? 0)) throw new Error("gcs_upload_failed:412:{}");
    const generation = ++bucket.seq;
    bucket.objects.set(p.objectName, { buffer: Buffer.from(p.buffer), generation });
    return { bucket: "test", objectName: p.objectName, gcsUri: `gs://test/${p.objectName}`, generation: String(generation) };
  };
  return { ...await importOriginal<any>(),
    getGcsBucketName: () => "test",
    signGsUriV4ReadUrl: (uri: string) => uri.replace("gs://", "https://storage.googleapis.com/"),
    statGcsObjectVersion: stat,
    downloadGcsObjectVersioned: async (p: { gcsUri: string }) => { const s = await stat(p); return { ...s, buffer: bucket.objects.get(s.objectName)!.buffer }; },
    uploadBufferToGcs: upload,
    uploadBufferToGcsIfAbsent: async (p: any) => { if (!bucket.objects.has(p.objectName)) await upload(p); },
  };
});

import { editableLayoutSchema, layoutLibrarySchema, type EditableLayout, type LayoutLibrary } from "../../shared/editableLayout";
import { knowledgeManuscript, knowledgeReviewBatches, knowledgeReviewSchema, knowledgeBatchResultSchema, knowledgeBatchRequestId } from "../../shared/knowledgePublication";
import { knowledgeReadingCharBudgets, KNOWLEDGE_READING_CONTRACT } from "../../shared/knowledgeEditionBudget";
import { knowledgeParallelAfterBatch } from "../../client/src/lib/knowledgePublicationParallelState";
import { KNOWLEDGE_CONVERSATION_ANSWER_MAX_CHARS } from "../../shared/knowledgeConversation";
import { layoutFromSource } from "../../shared/editableLayout";
import { KNOWLEDGE_CHAPTER_REVIEW_MAX_CHARS, knowledgeChapterCapacityIssues } from "../../shared/knowledgePublication";
import { knowledgeNonWhitespaceLength } from "../../shared/knowledgeEditionBudget";
import { readCanonicalLayoutLibrary, writeLayoutLibrary, layoutLibraryBufferCache, layoutParsedLibraryCache } from "./editableLayoutStore";
import { buildKnowledgeReviewRequest, knowledgePublicationAdvisorDeps, knowledgeSourceDigest, KNOWLEDGE_REVIEW_REQUEST_MAX_TOKENS, KNOWLEDGE_COMPRESSION_CAPACITY_RATIO, reviewKnowledgePublication, validateKnowledgePublicationAccess, knowledgePublicationWorkPlan, knowledgeEvidencePrefix, KNOWLEDGE_VISUAL_ADVISOR_MODEL } from "./knowledgePublicationAdvisor";
import { reviewKnowledgeConversation } from "./knowledgeConversationAdvisor";
import { loadKnowledgeBookLayoutInput, loadKnowledgeBookLayoutView, knowledgeBookLayoutCache, knowledgeBookLayoutInput, KNOWLEDGE_BOOK_LAYOUT_REQUEST_MAX_BYTES } from "./knowledgeBookLayout";

const OWNER = 7;
const uid = (seed: string) => { const h = createHash("sha256").update(seed).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const sha = (v: unknown) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");
/** 编号也写成汉字：替身正文按真实中文约 3 字节/字计量，请求体字节数才可信。 */
const cn = (v: string) => v.replace(/[0-9a-z]/gi, c => "〇一二三四五六七八九甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地人和"[parseInt(c, 36)]!);
/** 每句互不相同的中文（确定性去重只删重复句；替身稿不能被误删）。 */
const prose = (tag: string, chars: number) => { let s = "", k = 0; const t = cn(tag); while (s.length < chars) s += `${t}第${cn((k++).toString(10))}条要点记述史实经过、前因与影响。`; return s.slice(0, chars); };
const design = { palette: "ink-cinnabar", layout: "editorial", table: "rules", frame: "none", motif: "bamboo-seal", reason: "依据本章具体内容组织层次，保持完整正文可读。" } as const;
/** 模型每页除正文外的输出（按审校合同估）：8 条事实 × 约 70 字、读图描述约 120 字、1 条疑点约 100 字。 */
const facts = (tag: string) => Array.from({ length: 8 }, (_, j) => ({ term: `${tag}要点${j}`, statement: prose(`${tag}事实${j}`, 64) }));

type Scale = { name: string; chapters: number; supplementChars: number; legacy?: boolean; reviewOvershoot?: number; layoutAnswerChars?: number };
type Metrics = Record<string, any>;

function buildLibrary(s: Scale): LayoutLibrary {
  const title = `${s.name} 演练手册`;
  const pages = Array.from({ length: s.chapters }, (_, i) => ({
    id: uid(`${s.name}-page-${i}`), headline: `第${i + 1}章 ${s.name}主题${i + 1}`,
    body: prose(`${s.name}图${i}`, 200),
    ...(s.legacy ? {} : { supplement: `### 图外小节\n\n${prose(`${s.name}补${i}`, s.supplementChars)}` }),
    imageUrl: `gs://test/images/${s.name}/${i}.png`, imageJobId: `${s.name}-job-${i}`, role: "illustration" as const,
  }));
  for (const [i, p] of pages.entries()) bucket.jobs.set(p.imageJobId, { userId: String(OWNER), status: "succeeded",
    input: { action: "platform_composite_sheet_progress", params: { kind: "single_page_knowledge_card" } }, output: { compositeImageUrl: p.imageUrl, index: i } });
  const source = { title, detailLevel: "full", reviewBatchMode: "ready-images", readingContract: KNOWLEDGE_READING_CONTRACT, pages };
  const doc = editableLayoutSchema.parse({
    id: uid(`${s.name}-doc`), sourceId: `${s.name}-source`, title, aspect: "3:4", theme: "paper", fontSize: 24, updatedAt: "2026-11-21T00:00:00.000Z",
    pages: pages.map(p => ({ id: p.id, headline: p.headline, body: p.body, imageUrl: p.imageUrl, imagePlacement: "below" })),
    publication: { version: 1, requestId: uid(`${s.name}-request`), billing: { version: "interior-pages-v1", confirmed: false }, readingBudgetVersion: 2,
      source, parallel: { channels: {}, completed: [], family: "glm" }, manuscript: knowledgeManuscript({ title, pages }), completedBatches: 0, attempts: {} },
  });
  return layoutLibrarySchema.parse({ version: 1, owner: String(OWNER), documents: [doc] });
}

const envelope = (value: unknown, image: boolean) => ({ status: 200, text: JSON.stringify({ modelVersion: KNOWLEDGE_VISUAL_ADVISOR_MODEL,
  usageMetadata: { promptTokensDetails: image ? [{ modality: "IMAGE", tokenCount: 100 }] : [] },
  candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] }) });

/** 云稿保存：读当前 generation → 改 → 正式 writeLayoutLibrary（含全部保存校验）；记录 CPU 时间。 */
async function saveLibrary(m: Metrics, label: string, mutate: (doc: EditableLayout) => void) {
  const { library, generation } = await readCanonicalLayoutLibrary(OWNER);
  mutate(library!.documents[0]!);
  const cpu = process.cpuUsage(), t = performance.now();
  const result = await writeLayoutLibrary(OWNER, library!, generation);
  const used = process.cpuUsage(cpu);
  (m.saves ||= []).push({ label, ms: Math.round(performance.now() - t), cpuMs: Math.round((used.user + used.system) / 1000) });
  m.libraryBytes = bucket.objects.get(`editable-layouts/user-${OWNER}/library.json`)!.buffer.length;
  return result;
}
const currentDoc = async () => (await readCanonicalLayoutLibrary(OWNER)).library!.documents[0]!;

async function rehearse(s: Scale) {
  const m: Metrics = { scale: s.name, chapters: s.chapters, requests: { review: [], compress: [], consistency: [], final: [], layout: [] } as Record<string, { bytes: number; outChars: number }[]> };
  const library = buildLibrary(s), docId = library.documents[0]!.id;
  // 首存：generation 0 建库（新建稿也走正式保存校验）。
  { const cpu = process.cpuUsage(), t = performance.now(); await writeLayoutLibrary(OWNER, library, "0"); const u = process.cpuUsage(cpu);
    m.saves = [{ label: "create", ms: Math.round(performance.now() - t), cpuMs: Math.round((u.user + u.system) / 1000) }];
    m.libraryBytes = bucket.objects.get(`editable-layouts/user-${OWNER}/library.json`)!.buffer.length; }
  const source = library.documents[0]!.publication!.source;
  const budgets = new Map(knowledgeReadingCharBudgets("full", source.pages, source.readingContract, 2).pages.map(p => [p.id, p.maxChars]));
  const overshoot = s.reviewOvershoot ?? 1.2;
  const reviewPage = (page: any, chars: number, image: boolean) => {
    const text = prose(page.id.slice(0, 8), chars);
    return { id: page.id, headline: page.headline, body: `### 本章要点\n\n${text}`, imageDescription: image ? prose(`图述${page.id.slice(0, 6)}`, 120) : "",
      imageStatus: image ? "consistent" : "absent", facts: facts(page.id.slice(0, 6)), cautions: [{ kind: "image_text", evidence: "图中题注", message: prose("核对", 90) }],
      reading: { version: 1, subtitle: "", accent: "jade", decoration: { artworkId: "none", header: "plain", divider: "none", table: "plain", interleave: "none", reason: "按本章内容选择朴素版式。", design },
        // 单块正文 ≤12000 字（knowledgeReadingSchema）；长章按 1 万字分块。
        blocks: Array.from({ length: Math.ceil(text.length / 10_000) }, (_, b) => ({ type: "prose", title: `本章要点${b ? b + 1 : ""}`, note: "", text: text.slice(b * 10_000, (b + 1) * 10_000) })) } };
  };
  const post = vi.fn(async (request: any) => {
    const bytes = Buffer.byteLength(JSON.stringify(request), "utf8");
    const parts = request.contents[0].parts;
    const payloads = parts.map((p: any) => { try { return JSON.parse(p.text); } catch { return {}; } });
    const system = request.systemInstruction.parts.map((p: any) => p.text).join("\n");
    const image = parts.some((p: any) => "fileData" in p);
    let kind: string, value: any;
    if (request.researchOnly || /最终事实核对|离线对照/.test(system)) {
      kind = "consistency"; const p = payloads.find((x: any) => x.sourceDigest);
      value = { sourceDigest: p.sourceDigest, findings: [] };
    } else {
      const p = payloads.find((x: any) => x.source);
      kind = /篇幅压缩|篇幅扩写/.test(system) ? "compress" : /最终成稿修订/.test(system) ? "final" : "review";
      const caps = new Map((request.pageBudgets || []).map((b: any) => [b.id, b.maxChars]));
      value = { kind: "knowledge_publication_v1", sourceDigest: p.sourceDigest, title: p.source.title, pages: p.source.pages.map((page: any) =>
        reviewPage(page, kind === "compress" ? Math.floor(Number(caps.get(page.id) ?? 700) * 0.8) : Math.ceil((budgets.get(page.id) ?? 700) * overshoot), Boolean(page.imageUrl))) };
    }
    const out = envelope(value, image);
    m.requests[kind].push({ bytes, outChars: JSON.stringify(value).length });
    if (kind === "compress") (m.compressRequestDigests ||= []).push(sha(request));
    return out;
  });
  const advisor = { post, image: async (uri: string) => ({ buffer: Buffer.from(uri), sha256: sha(uri), mimeType: "image/png", width: 1024, height: 1365 }), recordImage: async () => false };

  const finish = () => {
    m.max = Object.fromEntries(Object.entries(m.requests as Record<string, { bytes: number; outChars: number }[]>).map(([k, v]) => [k, { n: v.length, bytes: Math.max(0, ...v.map(x => x.bytes)), outChars: Math.max(0, ...v.map(x => x.outChars)) }]));
    return m;
  };
  // 1. 逐章整理：先固定各批通道（与前台 assign 一致），再逐批正式审校；每批结果按前台合并写回云稿。
  const batches = knowledgeReviewBatches(source);
  m.reviewBatches = batches.length;
  await saveLibrary(m, "assign-channels", doc => { doc.publication!.parallel!.channels = Object.fromEntries(batches.map((_, i) => [String(i), i % 2 ? "openrouter" : "evolink"])); });
  const results: any[] = [];
  const reviewCpu = process.cpuUsage();
  for (let i = 0; i < batches.length; i++) {
    const context = { documentId: docId, batchIndex: i, attempt: 0 };
    try {
      if (i === 0) await validateKnowledgePublicationAccess(OWNER, context, knowledgeBatchRequestId(library.documents[0]!.publication!.requestId, 0, 0));
      results.push(knowledgeBatchResultSchema.parse(await reviewKnowledgePublication(OWNER, context, advisor)));
    } catch (e) { m.stuck = `审校第${i + 1}批：${e instanceof Error ? e.message : e}`; return finish(); }
  }
  m.reviewCpuMs = Math.round((process.cpuUsage(reviewCpu).user) / 1000);
  // 前台每批合并保存（合并更新器在同时到达时合并；这里按一次整库保存记录全部批次结果，单次保存耗时见 saves）。
  await saveLibrary(m, "chapter-reviews", doc => {
    let pub = doc.publication!;
    for (const result of results) {
      pub = { ...pub, chapterReviewDigest: result.sourceDigest, chapterReviews: { ...pub.chapterReviews, ...Object.fromEntries(result.pages.map((p: any) => [p.id, p])) } };
      pub = knowledgeParallelAfterBatch(pub, result.batchIndex, batches.length).publication;
    }
    doc.publication = pub;
  });

  // 2. 统稿：按正式工作计划逐步推进（新合同稿＝一次零调用汇总 + 最终压缩；旧结构稿走全册核对）。
  let doc = await currentDoc();
  const plan = await knowledgePublicationWorkPlan(OWNER, doc as any);
  m.totalBatches = plan.totalBatches;
  let review: any;
  for (let i = batches.length; i < plan.totalBatches; i++) {
    const context = { documentId: docId, batchIndex: i, attempt: 0 };
    await validateKnowledgePublicationAccess(OWNER, context, knowledgeBatchRequestId(doc.publication!.requestId, i, 0));
    review = await reviewKnowledgePublication(OWNER, context, advisor);
  }
  review = knowledgeReviewSchema.parse(review);
  const root = knowledgeEvidencePrefix(OWNER, docId, doc.publication!.requestId);
  m.root = root;
  m.skippedConsistency = !bucket.objects.has(`${root}/consistency-plan.json`);
  m.finalCompressGroups = Array.from(bucket.objects.keys()).filter(k => k.startsWith(`${root}/final-compress/`) && /\/raw-0\.json$/.test(k)).length;
  await saveLibrary(m, "consolidated", d => {
    d.publication = { ...d.publication!, review, completedBatches: plan.totalBatches, manuscript: knowledgeManuscript(review), confirmedManuscript: undefined };
    d.title = review.title; d.pages = d.pages.map((p, n) => ({ ...p, headline: review.pages[n].headline, body: review.pages[n].body }));
  });

  // 3. 导出输入 → 整册排版（分组并行）→ 采用 → 整册视图。
  try {
    const input = await loadKnowledgeBookLayoutInput(OWNER, docId);
    m.layoutInputBytes = Buffer.byteLength(JSON.stringify(input), "utf8");
    m.layoutSourceDigest = input.sourceDigest;
    const requestId = uid(`${s.name}-layout`);
    doc = await currentDoc();
    await saveLibrary(m, "layout-request", d => { d.publication!.conversation = [{ request: { id: requestId, question: "请根据完整正文和现有全部图卡重新安排整册顺序与设计", imagePageIds: [], manuscript: d.publication!.manuscript, action: "layout", layoutSourceDigest: input.sourceDigest } }]; });
    const layoutPost = vi.fn(async (request: any) => {
      const bytes = Buffer.byteLength(JSON.stringify(request), "utf8");
      const modelInput = JSON.parse(request.contents[0].parts[0].text);
      const pages = modelInput.bookLayout.pages;
      const answer = { kind: "knowledge_conversation_v1", requestId: modelInput.conversation.requestId, answer: prose("排版说明", s.layoutAnswerChars ?? 600), sources: [], supplementalImages: [],
        layoutPlan: { kind: "knowledge_book_layout_v1", sourceDigest: modelInput.bookLayout.sourceDigest, chapters: pages.map((p: any) => ({ pageId: p.id, design,
          presentation: { reading: { version: 1, subtitle: "", accent: "jade", blocks: Array.from({ length: Math.ceil(p.body.length / 10_000) }, (_, b) => ({ type: "prose", title: `本章要点${b ? b + 1 : ""}`, note: "", text: p.body.slice(b * 10_000, (b + 1) * 10_000) })) }, imageEvidencePageIds: [p.id], reason: "制度结构由已审校原图承载，文字说明适用边界。" } })) } };
      m.requests.layout.push({ bytes, outChars: JSON.stringify(answer).length });
      (m.layoutRequestDigests ||= []).push(sha(request));
      return { status: 200, text: JSON.stringify({ modelVersion: KNOWLEDGE_VISUAL_ADVISOR_MODEL, candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(answer) }] } }] }) };
    });
    const answer = await reviewKnowledgeConversation(OWNER, { documentId: docId, purpose: "conversation", batchIndex: 0, attempt: 0 }, { post: layoutPost as any });
    m.layoutGroups = layoutPost.mock.calls.length;
    m.layoutAnswerChars = answer.answer.length;
    m.layoutAnswer = answer.answer;
    m.layoutGroupAnswers = layoutPost.mock.results.map(r => r.value).length;
    const saved = await saveLibrary(m, "layout-adopted", d => { d.publication!.conversation![0]!.response = answer; d.publication!.layoutConversationId = requestId; });
    // 恢复回放：再请求一次同一排版，必须零调用取回与云稿 turn.response 逐字相同的结果。
    const replay = await reviewKnowledgeConversation(OWNER, { documentId: docId, purpose: "conversation", batchIndex: 0, attempt: 0 }, { post: (async () => { throw new Error("回放不得调用模型"); }) as any });
    m.replayEqual = JSON.stringify(replay) === JSON.stringify(answer);
    knowledgeBookLayoutCache.clear();
    const view = await loadKnowledgeBookLayoutView(OWNER, docId, String(saved.generation));
    m.viewPages = view.doc.pages.length;
    m.reached = "view";
  } catch (e) {
    m.stuck = e instanceof Error ? e.message : String(e);
  }
  m.reviewReportSha = sha(review);
  return finish();
}

const report = (m: Metrics) => console.log(`[规模演练] ${JSON.stringify({ ...m, requests: undefined, layoutAnswer: undefined, layoutRequestDigests: m.layoutRequestDigests?.length, compressRequestDigests: m.compressRequestDigests ? sha([...m.compressRequestDigests].sort()) : undefined })}`);

beforeEach(() => { bucket.objects.clear(); bucket.jobs.clear(); layoutLibraryBufferCache.clear(); layoutParsedLibraryCache.clear(); knowledgeBookLayoutCache.clear(); });

describe("手册后半程多规模演练（替身模型 + 内存存储）", () => {
  it("4 章小书（新结构，带图外内文）：全程走通，统稿零调用汇总、不跑全册核对", async () => {
    const m = await rehearse({ name: "s4", chapters: 4, supplementChars: 2000 });
    report(m);
    expect(m.stuck).toBeUndefined();
    expect(m.reached).toBe("view");
    expect(m.skippedConsistency).toBe(true);
    expect(m.totalBatches).toBe(m.reviewBatches + 1);
    expect(m.max.consistency.n).toBe(0);
    expect(m.viewPages).toBe(4);
  }, 60_000);

  it("4 章旧结构稿（无图外内文）：行为不变——仍走全册核对分支，整册排版请求身份逐字不变", async () => {
    const m = await rehearse({ name: "legacy4", chapters: 4, supplementChars: 0, legacy: true });
    report(m);
    expect(m.stuck).toBeUndefined();
    expect(m.reached).toBe("view");
    expect(m.skippedConsistency).toBe(false);
    // 金值：在 c30e8a9 基线（未改排版输入上限）上实测记录；改动后必须逐字一致（输入摘要与每组请求体都不变）。
    expect({ digest: m.layoutSourceDigest, requests: m.layoutRequestDigests, review: m.reviewReportSha, compress: sha([...m.compressRequestDigests].sort()) }).toEqual(LEGACY4_GOLDEN);
    expect(m.replayEqual).toBe(true);
  }, 60_000);

  it("48 章 × 图外内文 5.5 万字（今晚线上规模）：全程走通；每个请求体与云稿体积在上限内", async () => {
    const m = await rehearse({ name: "s48", chapters: 48, supplementChars: 55_000 });
    report(m);
    expect(m.stuck).toBeUndefined();
    expect(m.reached).toBe("view");
    expect(m.skippedConsistency).toBe(true);
    expect(m.reviewBatches).toBe(48);
    // 金值同上：48 章排版输入摘要与各组请求体不因改动而变。
    expect({ digest: m.layoutSourceDigest, requests: sha(m.layoutRequestDigests || []), review: m.reviewReportSha, compress: sha([...m.compressRequestDigests].sort()) }).toEqual(S48_GOLDEN);
    expect(m.replayEqual).toBe(true);
    // 未超限的稿：合并后的排版说明 = 各组说明按序以空行连接（逐字不变）。
    expect(m.layoutAnswer).toBe(Array.from({ length: m.layoutGroups }, () => prose("排版说明", 600)).join("\n\n"));
    // 审校与压缩请求体的容量核算上限是 800000（getRaw）；排版每组 750000。
    expect(m.max.review.bytes).toBeLessThan(800_000);
    expect(m.max.compress.bytes).toBeLessThan(800_000);
    expect(m.max.layout.bytes).toBeLessThan(750_000);
    expect(m.layoutInputBytes).toBeLessThan(KNOWLEDGE_BOOK_LAYOUT_REQUEST_MAX_BYTES);
    expect(m.libraryBytes).toBeLessThan(64 * 1024 * 1024);
  }, 300_000);

  it("200 章同结构：全程走通（整册排版输入超过 65 万字节，但每组请求在单次容量内）", async () => {
    const m = await rehearse({ name: "s200", chapters: 200, supplementChars: 55_000 });
    report(m);
    expect(m.stuck).toBeUndefined();
    expect(m.reached).toBe("view");
    expect(m.layoutInputBytes).toBeGreaterThan(KNOWLEDGE_BOOK_LAYOUT_REQUEST_MAX_BYTES);
    expect(m.layoutGroups).toBe(50);
    expect(m.max.layout.bytes).toBeLessThan(750_000);
    expect(m.max.review.bytes).toBeLessThan(800_000);
    expect(m.max.compress.bytes).toBeLessThan(800_000);
    expect(m.libraryBytes).toBeLessThan(64 * 1024 * 1024);
  }, 600_000);
});

// 金值：在 c30e8a9 基线（整册排版输入按整册判断 65 万字节）上实测记录。
const LEGACY4_GOLDEN = { digest: "c04522a97a2d86e60edf3cffe9b41ae21d7416dfb5259f9c579a1646b3b9a300", requests: ["609100132f17631d22130c4d4d028034ad6eaee9e1f36b17052330acbce8f57c"], review: "1631ee99091d3e9a64eff9641864a46dbcfc07463d14a19f826ad7061c910e31", compress: "0ffaf2a91f9abe2e45c92899455f029b401765b18bf97ad84bfb9ab773a94444" };
const S48_GOLDEN = { digest: "82d5ada79240c6ab104172b8c1aff4125ecc56a32a5d8e5136d60a5d6e90570d", requests: "6a639e82c05f29b5927dc3f4da15d9f77f4011293d55bb10736017e0481312f6", review: "15e27fc3c62268279459f06ad19612cbd71b700b8620f0ef57a54791fbf35ad5", compress: "ea0c3479ff99a03c733ef5e12a36f7a2223eb5b6bb16617ce2c7ee472bfe4505" };

describe("随规模出问题的边界（先钉住、后修掉）", () => {
  it("整册排版输入：容量按单组判断——单组超过 65 万字节仍拒收，不截断", () => {
    const pages = Array.from({ length: 2 }, (_, i) => ({ id: uid(`cap-${i}`), headline: `章${i}`, body: prose(`容${i}`, 300), imageUrl: "" }));
    const review = { kind: "knowledge_publication_v1" as const, sourceDigest: "a".repeat(64), title: "容量", pages: pages.map(p => ({ id: p.id, headline: p.headline, body: p.body, imageDescription: "", imageStatus: "absent" as const,
      // 事实条数没有上限：一章的事实索引可以单独撑爆一组
      facts: Array.from({ length: p.id === pages[0]!.id ? 4000 : 1 }, (_, j) => ({ term: `事${j}`, statement: prose(`述${j}`, 60) })), cautions: [] })) };
    const doc = editableLayoutSchema.parse({ id: uid("cap-doc"), sourceId: "cap", title: "容量", aspect: "3:4", theme: "paper", fontSize: 24, updatedAt: "2026-11-21T00:00:00.000Z", pages: pages.map(p => ({ ...p, imagePlacement: "below" })) });
    expect(() => knowledgeBookLayoutInput({ doc, review, receipt: { report: review, sourceImages: [] }, prefix: "x" } as any)).toThrow("整册排版超出单次容量");
    review.pages[0]!.facts = review.pages[0]!.facts.slice(0, 1);
    expect(knowledgeBookLayoutInput({ doc, review, receipt: { report: review, sourceImages: [] }, prefix: "x" } as any).pages).toHaveLength(2);
  });

  it("200 章旧结构稿 50 组排版：每组说明 2700 字、合并超 131072 字时改为简短汇总；各组原说明完整保留在分组回执，回放与云稿一致", async () => {
    const ok = await rehearse({ name: "legacy200ok", chapters: 200, supplementChars: 0, legacy: true, layoutAnswerChars: 2600 });
    report(ok);
    expect(ok.reached).toBe("view");
    expect(ok.layoutGroups).toBe(50);
    // 未超限：逐字等于各组说明以空行连接
    expect(ok.layoutAnswer).toBe(Array.from({ length: 50 }, () => prose("排版说明", 2600)).join("\n\n"));
    bucket.objects.clear(); bucket.jobs.clear(); layoutLibraryBufferCache.clear(); layoutParsedLibraryCache.clear(); knowledgeBookLayoutCache.clear();
    const over = await rehearse({ name: "legacy200over", chapters: 200, supplementChars: 0, legacy: true, layoutAnswerChars: 2700 });
    report(over);
    expect(over.stuck).toBeUndefined();
    expect(over.reached).toBe("view");
    expect(over.replayEqual).toBe(true);
    expect(over.layoutAnswer.length).toBeLessThanOrEqual(KNOWLEDGE_CONVERSATION_ANSWER_MAX_CHARS);
    expect(over.layoutAnswer).toMatch(/^共 50 组/);
    // 各组原说明一字不少地留在分组回执
    const groups = Array.from(bucket.objects.keys()).filter(k => /\/conversation\/[^/]+\/batch-\d+\/report\.json$/.test(k));
    expect(groups).toHaveLength(50);
    for (const key of groups) expect(JSON.parse(bucket.objects.get(key)!.buffer.toString("utf8")).answer.answer).toBe(prose("排版说明", 2700));
  }, 300_000);

  it("小书大图外内文：3 章 × 5.5 万字，新预算每章 10 页续页（上限 13700 字）——排版展示正文按预算放行（原 12000 字上限会卡住）", async () => {
    const m = await rehearse({ name: "s3big", chapters: 3, supplementChars: 55_000, reviewOvershoot: 0.95 });
    report(m);
    expect(m.max.compress.n).toBe(0); // 审校稿在预算内，统稿不压缩
    expect(m.stuck).toBeUndefined();
    expect(m.reached).toBe("view");
  }, 120_000);

  it("单章容量：整理入口对超出单次请求的章给出业务错误；篇幅压缩按字节分组（6 章 × 10 万字）全部完成", async () => {
    const m = await rehearse({ name: "cap1", chapters: 2, supplementChars: 300_000 });
    report(m);
    // 已建好的稿（绕过建稿检查）：整理入口在发请求前给出明确业务错误——第几章、超出多少，没有调用模型，也没有截断。
    expect(m.stuck).toMatch(/审校第1批：第1章《[^》]+》正文与图外内文过长，超过单次整理容量约[\d,]+字/);
    expect(m.max.review.n).toBe(0);
    // 六章各 10 万字：逐章审校（单章约 30 万字节）能过；统稿后篇幅压缩若固定三章一组约 90 万字节会超容量，改按字节分组后全部压缩完成。
    bucket.objects.clear(); bucket.jobs.clear(); layoutLibraryBufferCache.clear(); layoutParsedLibraryCache.clear();
    const g = await rehearse({ name: "cap6", chapters: 6, supplementChars: 100_000 });
    report(g);
    expect(g.reached).toBe("view");
    const budget = JSON.parse(bucket.objects.get(`${g.root}/final-compress/budget.json`)!.buffer.toString("utf8"));
    expect(budget.error).toBeUndefined();
    expect(budget.after).toHaveLength(0);
    // 固定三章一组约 90 万字节会超单次容量：改按字节分组（每组 ≤ 上限 × 安全比例），每组都在容量内
    expect(g.max.compress.n).toBeGreaterThan(2);
    expect(g.max.compress.bytes).toBeLessThan(800_000 * KNOWLEDGE_COMPRESSION_CAPACITY_RATIO);
  }, 120_000);
});

describe("容量常量与提速等价性", () => {
  it(`单章整理容量常量：正文 + 图外内文 ≤ ${KNOWLEDGE_CHAPTER_REVIEW_MAX_CHARS} 汉字时单次整理请求必在 80 万字节内；建稿时超出即报第几章、超出多少`, async () => {
    expect(KNOWLEDGE_CHAPTER_REVIEW_MAX_CHARS).toBe(240_000);
    const page = (i: number, chars: number) => ({ id: uid(`cap-const-${i}`), headline: `第${i + 1}章`, body: "图".repeat(2000), supplement: "史".repeat(chars - 2000), imageUrl: `gs://test/c/${i}.png`, imageJobId: `c-${i}`, role: "illustration" as const });
    const source = { title: "容量", detailLevel: "full" as const, reviewBatchMode: "ready-images" as const, readingContract: KNOWLEDGE_READING_CONTRACT, pages: [page(0, KNOWLEDGE_CHAPTER_REVIEW_MAX_CHARS)] };
    const request = buildKnowledgeReviewRequest(source, "a".repeat(64), new Map([[source.pages[0]!.imageUrl, { mimeType: "image/png" }]]));
    // 预算与输出合同、邻章上下文（各 2000 字图中文字）按最长形态补齐
    request.systemInstruction.parts.push({ text: "预".repeat(8000) });
    request.contents[0]!.parts.unshift({ text: "邻".repeat(4000) });
    expect((await knowledgePublicationAdvisorDeps().count(request)).totalTokens).toBeLessThanOrEqual(KNOWLEDGE_REVIEW_REQUEST_MAX_TOKENS);
    expect(knowledgeChapterCapacityIssues(source.pages)).toEqual([]);
    const over = [page(0, 1000 + 2000), { ...page(1, KNOWLEDGE_CHAPTER_REVIEW_MAX_CHARS + 1234), headline: "大章" }];
    expect(knowledgeChapterCapacityIssues(over)).toEqual([{ index: 1, headline: "大章", chars: KNOWLEDGE_CHAPTER_REVIEW_MAX_CHARS + 1234, excess: 1234 }]);
    expect(() => layoutFromSource({ kind: "knowledge-publication", owner: "7", sourceId: "big", title: "大书", body: "", detailLevel: "full", readingContract: KNOWLEDGE_READING_CONTRACT,
      pages: over.map((p, i) => ({ pageIndex: i + 1, headline: p.headline, body: p.body, supplement: p.supplement, knowledgeRole: "illustration" as const, imageJobId: p.imageJobId })) })).toThrow(/第2章《大章》正文与图外内文共[\d,]+字，超出单章整理上限[\d,]+字（超出1,234字）/);
  });

  it("非空白字数：与 replace(/\\s+/g, \"\").length 对全部 BMP 码元逐一等价", () => {
    for (let c = 0; c < 0x10000; c++) {
      const v = `a${String.fromCharCode(c)}b`;
      if (knowledgeNonWhitespaceLength(v) !== v.replace(/\s+/g, "").length) throw new Error(`码元 ${c.toString(16)} 不等价`);
    }
    const mixed = "一\u3000二\n\t三\ufeff四\u2028 \ud83d\ude00五";
    expect(knowledgeNonWhitespaceLength(mixed)).toBe(mixed.replace(/\s+/g, "").length);
  });

  it("原稿摘要缓存：同内容不同对象结果逐字相同；内容改一字摘要即变", () => {
    const lib = buildLibrary({ name: "dig", chapters: 3, supplementChars: 20_000 });
    const source = lib.documents[0]!.publication!.source;
    const a = knowledgeSourceDigest(source), b = knowledgeSourceDigest(structuredClone(source));
    const plain = createHash("sha256").update(JSON.stringify({ ...source, pages: source.pages.map(p => p.imageJobId ? { ...p, imageUrl: "" } : p) })).digest("hex");
    expect(a).toBe(plain); expect(b).toBe(plain);
    const changed = structuredClone(source); changed.pages[2]!.supplement += "。";
    expect(knowledgeSourceDigest(changed)).not.toBe(plain);
    expect(knowledgeSourceDigest(source)).toBe(plain);
  });
});
