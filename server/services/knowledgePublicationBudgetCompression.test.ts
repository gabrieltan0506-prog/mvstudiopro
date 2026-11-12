import { describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ jobs: new Map<string, any>() }));
vi.mock("../jobs/repository", async importOriginal => ({ ...await importOriginal<any>(), getJobByIdStrict: vi.fn(async (id: string) => state.jobs.get(id) || null) }));
vi.mock("./gcs", async importOriginal => ({ ...await importOriginal<any>(), getGcsBucketName: () => "test", signGsUriV4ReadUrl: (uri: string) => uri.replace("gs://", "https://storage.googleapis.com/") }));
vi.mock("./postProdMediaSource", async importOriginal => ({ ...await importOriginal<any>(), loadSucceededJobOutputSources: async () => ({ objects: new Set(), urls: new Set() }), resolveRegisteredPostProdMediaSource: async ({ source }: { source: string }) => source.replace("https://storage.googleapis.com/", "gs://") }));
import { synchronizedKnowledgeCardSource } from "../../shared/knowledgeCardEditableLayout";
import { layoutFromSource } from "../../shared/editableLayout";
import { compileKnowledgeEditions } from "../../shared/knowledgeCardEdition";
import { knowledgeEditionImagePlan } from "../../shared/knowledgeCardPagination";
import { KNOWLEDGE_IMAGE_PRIMARY_INSTRUCTIONS, KNOWLEDGE_IMAGE_PRIMARY_MARKER, KNOWLEDGE_LEAD_PAGE_CHARS, KNOWLEDGE_READING_CONTRACT, knowledgeReadingCharBudgets } from "../../shared/knowledgeEditionBudget";
import { compressKnowledgeFinalReport, KNOWLEDGE_COMPRESSION_GROUP_CHAPTERS, dedupeKnowledgeReviewAgainstImages, KNOWLEDGE_REVIEW_INSTRUCTIONS, knowledgeExplanationInstructions, reviewKnowledgePublication, knowledgeSourceDigest, knowledgeEvidencePrefix, knowledgeReviewPageChars, KNOWLEDGE_VISUAL_ADVISOR_MODEL } from "./knowledgePublicationAdvisor";

const sentence = (i: number, j: number) => `第${i}节第${j}句记述一件具体史实，以及它前后的经过与影响。`;
const book = compileKnowledgeEditions("敦煌测试", Array.from({ length: 12 }, (_, i) => ({
  headline: `原小节${i}`, body: Array.from({ length: 40 }, (_, j) => sentence(i, j)).join(""), priority: "primary" as const,
})));
// 每句互不相同（确定性去重只删重复句，不应影响模型稿的字数断言）。
const prose = (chars: number) => Array.from({ length: Math.ceil(chars / 10) + 1 }, (_, i) => `壁画${String(i).padStart(4, "0")}年代考。`).join("").slice(0, chars);

// 2026-11-11 起新建稿件带正文合同 image-primary-v1；本文件原有用例覆盖的是此前建立的稿件（无合同字段），
// 默认按旧稿构造以继续验证旧稿行为不变；新合同用例显式传 { contract: true }。
function harness(initial: number | "fail" | (number | "fail")[], options: { contract?: boolean } = {}) {
  let compressChars: number | "fail" | (number | "fail")[] = initial;
  let compressCalls = 0;
  state.jobs.clear();
  const plan = knowledgeEditionImagePlan(book.full)!;
  const imageJobIds = plan.images.map((_, i) => `img-job-${i}`);
  imageJobIds.forEach((id, i) => state.jobs.set(id, { userId: "7", status: "succeeded", input: { action: "platform_composite_sheet_progress", params: { kind: "single_page_knowledge_card" } }, output: { compositeImageUrl: `https://storage.googleapis.com/test/${i}.png` } }));
  const created = synchronizedKnowledgeCardSource({ owner: "7", sourceId: "dh", fullMarkdown: book.full, illustrationMarkdown: book.full, detailLevel: "full", imageJobIds });
  const doc = layoutFromSource(options.contract ? created : { ...created, readingContract: undefined });
  const source = doc.publication!.source, digest = knowledgeSourceDigest(source), storage = new Map<string, any>(), sha = "b".repeat(64);
  const calls: { kind: "review" | "compress"; ids: string[] }[] = [];
  /** 指定章的压缩请求返回未完整结束（并发下按章控制，不依赖调用顺序）。 */
  const failPages = new Set<string>();
  const post = vi.fn(async (request: any) => {
    const payload = request.contents[0].parts.map((p: any) => { try { return JSON.parse(p.text); } catch { return {}; } }).find((p: any) => p.source);
    const compress = request.systemInstruction.parts.some((p: any) => /篇幅压缩/.test(p.text));
    calls.push({ kind: compress ? "compress" : "review", ids: payload.source.pages.map((p: any) => p.id) });
    const planned = Array.isArray(compressChars) ? compressChars[Math.min(compressCalls, compressChars.length - 1)] : compressChars;
    if (compress) compressCalls++;
    if (compress && payload.source.pages.some((p: any) => failPages.has(p.id))) return { status: 200, text: JSON.stringify({ modelVersion: KNOWLEDGE_VISUAL_ADVISOR_MODEL, candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{}" }] } }] }) };
    if (compress && planned === "fail") return { status: 200, text: JSON.stringify({ modelVersion: KNOWLEDGE_VISUAL_ADVISOR_MODEL, candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{}" }] } }] }) };
    const value = { kind: "knowledge_publication_v1", sourceDigest: digest, title: source.title, pages: payload.source.pages.map((page: any) => ({
      id: page.id, headline: page.headline, body: page.body,
      imageDescription: page.imageUrl ? "壁画局部与年代标注" : "", imageStatus: page.imageUrl ? "consistent" : "absent",
      facts: [{ term: "壁画", statement: "敦煌壁画分期" }], cautions: compress ? [] : [{ kind: "image_text", evidence: "图中年代", message: "图中年代与正文一致，仅提示" }],
      reading: { version: 1, subtitle: "", accent: "jade", blocks: [{ type: "prose", title: "壁画分期", note: "", text: prose(compress ? (planned as number) : 1800) }] },
    })) };
    return { status: 200, text: JSON.stringify({ modelVersion: KNOWLEDGE_VISUAL_ADVISOR_MODEL, usageMetadata: { promptTokensDetails: payload.source.pages.some((p: any) => p.imageUrl) ? [{ modality: "IMAGE", tokenCount: 10 }] : [] }, candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] }) };
  });
  const deps = { load: async () => doc as any, read: async (name: string) => storage.get(name) || null, save: async (name: string, value: any) => { storage.set(name, structuredClone(value)); }, count: async () => ({ totalTokens: 500, method: "test" }), post, image: async () => ({ buffer: Buffer.from("image"), mimeType: "image/png", width: 10, height: 10, sha256: sha }) };
  return { failPages, setCompress: (v: number | "fail" | (number | "fail")[]) => { compressChars = v; compressCalls = 0; }, doc, source, digest, storage, post, calls, deps, root: knowledgeEvidencePrefix(7, doc.id, doc.publication!.requestId) };
}

describe("完整版图文同页：审校后按页预算压缩（预算的生产者）", () => {
  it("审校稿 1807 字超出图下 700 字 → 一次压缩调用只送超出页，压缩到 650 字即采纳；图片审校结论与图文疑点保留原值；回执落盘、再读零调用", async () => {
    const h = harness(650);
    const batch = await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps) as any;
    expect(h.calls.map(c => c.kind)).toEqual(["review", "compress"]);
    expect(h.calls[1]!.ids).toEqual([h.source.pages[0]!.id]);
    const page = batch.pages[0];
    // reading 生成稿 = “### 壁画分期”(7) + 正文 650
    expect(knowledgeReviewPageChars(page)).toBe(657);
    expect(knowledgeReviewPageChars(page)).toBeLessThanOrEqual(KNOWLEDGE_LEAD_PAGE_CHARS);
    expect(page.imageStatus).toBe("consistent");
    expect(page.imageDescription).toBe("壁画局部与年代标注");
    expect(page.cautions).toEqual([{ kind: "image_text", evidence: "图中年代", message: "图中年代与正文一致，仅提示" }]);
    expect(batch.budgetOverflow).toEqual({ before: [{ id: page.id, headline: h.source.pages[0]!.headline, chars: 1807, maxChars: 700, excess: 1107 }], after: [], adopted: [page.id], error: undefined });
    const keys = Array.from(h.storage.keys());
    expect(keys).toContain(`${h.root}/batch-0/compress/request-0.json`);
    expect(keys).toContain(`${h.root}/batch-0/compress/raw-0.json`);
    expect(h.storage.get(`${h.root}/batch-0/compress/budget.json`).adopted).toEqual([page.id]);
    expect(h.storage.get(`${h.root}/batch-0/report.json`).budgetOverflow.after).toEqual([]);
    // 压缩请求是廉价文字路由，不带图片
    const compressRequest = (h.post.mock.calls[1]![0] as any);
    expect(compressRequest.executionFamily).toBe("glm");
    expect(compressRequest.contents[0].parts.some((p: any) => "fileData" in p)).toBe(false);
    const again = await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps) as any;
    expect(h.post).toHaveBeenCalledTimes(2);
    expect(again.budgetOverflow.adopted).toEqual([page.id]);
  });

  it("压缩稿仍 900 字：比原稿短即采纳，但 after 仍报超出 200 字，不截断不阻断", async () => {
    const h = harness(900);
    const batch = await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps) as any;
    expect(knowledgeReviewPageChars(batch.pages[0])).toBe(907);
    expect(batch.budgetOverflow.adopted).toEqual([batch.pages[0].id]);
    expect(batch.budgetOverflow.after).toEqual([{ id: batch.pages[0].id, headline: h.source.pages[0]!.headline, chars: 907, maxChars: 700, excess: 207 }]);
  });

  it("压缩调用失败：保留 1800 字审校稿、记录 error 与超出页，审校批次仍成功", async () => {
    const h = harness("fail");
    const batch = await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps) as any;
    expect(knowledgeReviewPageChars(batch.pages[0])).toBe(1807);
    expect(batch.budgetOverflow.adopted).toEqual([]);
    expect(batch.budgetOverflow.error).toContain("未完整结束");
    expect(batch.budgetOverflow.after[0]!.excess).toBe(1107);
  });

  it("旧报告带压缩未完成（从未发出）：再读时补跑压缩，原报告另存 report-precompress.json，超出页不再带进排版", async () => {
    const h = harness("fail");
    await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps);
    // 模拟恢复入口当时零调用挡住首发压缩：压缩目录无任何回执
    for (const key of Array.from(h.storage.keys())) if (key.startsWith(`${h.root}/batch-0/compress/`)) h.storage.delete(key);
    const saved = structuredClone(h.storage.get(`${h.root}/batch-0/report.json`));
    h.setCompress(650);
    const again = await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps) as any;
    expect(h.calls.map(c => c.kind)).toEqual(["review", "compress", "compress"]);
    expect(knowledgeReviewPageChars(again.pages[0])).toBe(657);
    expect(again.budgetOverflow.after).toEqual([]);
    expect(again.budgetOverflow.priorError).toContain("未完整结束");
    expect(h.storage.get(`${h.root}/batch-0/report-precompress.json`)).toEqual(saved);
    await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps);
    expect(h.post).toHaveBeenCalledTimes(3);
  });
});

describe("篇幅压缩首发与多轮（2026-11-09 敦煌 62 页超出 56 页承诺）", () => {
  const holdLeftover = async (h: ReturnType<typeof harness>, receipt: boolean) => {
    await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps);
    const dir = `${h.root}/batch-0/compress`;
    // 模拟旧恢复入口零调用桩：请求已落盘、原回包不足以恢复、从未发出（无任何路由回执、无原始回包）
    const prior = structuredClone(h.storage.get(`${dir}/request-0.json`));
    prior.request.executionFamily = "deepseek"; prior.request.executionChannel = "openrouter";
    for (const key of Array.from(h.storage.keys())) if (key.startsWith(`${dir}/`)) h.storage.delete(key);
    h.storage.set(`${dir}/request-0.json`, prior);
    if (receipt) h.storage.set(`${dir}/attempt-0/route-openrouter.json`, { state: "unknown", route: "openrouter" });
    return prior;
  };

  it("无回执的压缩首发会真发请求：按当前正式链（GLM FlashX@EvoLink 首跳）发出，旧未发请求另存 request-0-unsent.json", async () => {
    const h = harness("fail");
    const prior = await holdLeftover(h, false);
    h.setCompress(650);
    const sentBefore = h.post.mock.calls.length;
    const again = await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps) as any;
    expect(h.post.mock.calls.length).toBe(sentBefore + 1);
    const sent = h.post.mock.calls.at(-1)![0] as any;
    expect(sent.executionFamily).toBe("glm");
    expect(sent.executionChannel).toBe("evolink");
    expect(h.storage.get(`${h.root}/batch-0/compress/request-0-unsent.json`)).toEqual(prior);
    expect(h.storage.get(`${h.root}/batch-0/compress/request-0.json`).request.executionFamily).toBe("glm");
    expect(knowledgeReviewPageChars(again.pages[0])).toBe(657);
    expect(again.budgetOverflow.after).toEqual([]);
  });

  it("已有未闭合回执：不当首发，沿用原请求身份交路由处理（不改请求、不另存 unsent）", async () => {
    const h = harness("fail");
    await holdLeftover(h, true);
    h.setCompress(650);
    await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps);
    const sent = h.post.mock.calls.at(-1)![0] as any;
    expect(sent.executionFamily).toBe("deepseek");
    expect(sent.executionChannel).toBe("openrouter");
    expect(h.storage.has(`${h.root}/batch-0/compress/request-0-unsent.json`)).toBe(false);
  });

  it("一轮未达标继续下一轮：900→650 两轮压缩到预算内；再读全部零调用回放", async () => {
    const h = harness([900, 650]);
    const batch = await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps) as any;
    expect(h.calls.map(c => c.kind)).toEqual(["review", "compress", "compress"]);
    expect(knowledgeReviewPageChars(batch.pages[0])).toBe(657);
    expect(batch.budgetOverflow.after).toEqual([]);
    expect(h.storage.has(`${h.root}/batch-0/compress/round-1/raw-0.json`)).toBe(true);
    // 压缩提示词目标 = 上限 × 0.85（700→595），每轮相同；验收仍按真实上限 700
    for (const call of [h.post.mock.calls[1]!, h.post.mock.calls[2]!]) {
      const req = call[0] as any;
      expect(req.systemInstruction.parts.some((p: any) => /"maxChars":595/.test(p.text))).toBe(true);
      expect(req.pageBudgets[0].maxChars).toBe(700);
      expect(req.budgetTolerance).toBe(0);
    }
    await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps);
    expect(h.post).toHaveBeenCalledTimes(3);
  });

  it("旧报告压缩过一遍仍超出（无 error）：再读时从下一轮继续压缩，旧轮次零调用回放", async () => {
    const h = harness(900);
    await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps);
    // 模拟旧代码只跑一轮、不记轮次结果
    for (const key of Array.from(h.storage.keys())) if (key.includes("/round-") || key.includes("/outcome-")) h.storage.delete(key);
    const report = h.storage.get(`${h.root}/batch-0/report.json`);
    report.budgetOverflow = { before: report.budgetOverflow.before, after: report.budgetOverflow.after, adopted: report.budgetOverflow.adopted };
    report.report.pages[0] = { ...report.report.pages[0], reading: { ...report.report.pages[0].reading, blocks: [{ type: "prose", title: "壁画分期", note: "", text: prose(900) }] } };
    h.setCompress(650);
    const calls = h.post.mock.calls.length;
    const again = await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps) as any;
    expect(h.post.mock.calls.length).toBe(calls + 1);
    expect(knowledgeReviewPageChars(again.pages[0])).toBe(657);
    expect(again.budgetOverflow.after).toEqual([]);
    expect(h.storage.get(`${h.root}/batch-0/report-precompress.json`).report.pages[0].reading.blocks[0].text.length).toBe(900);
  });

  it("整册报告再读也补压：最终修订写长的页按轮压缩，补压前报告另存 report-precompress.json，再读零调用", async () => {
    const h = harness(650);
    const batch = await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps) as any;
    const long = { ...batch.pages[0], reading: { ...batch.pages[0].reading, blocks: [{ type: "prose", title: "壁画分期", note: "", text: prose(1200) }] } };
    const saved = { report: { kind: "knowledge_publication_v1", sourceDigest: h.digest, title: h.source.title, pages: [long] }, sourceImages: [] };
    h.storage.set(`${h.root}/report.json`, saved);
    const calls = h.post.mock.calls.length;
    const next = await compressKnowledgeFinalReport(h.deps as any, h.root, 0, h.digest, h.source, structuredClone(saved));
    expect(h.post.mock.calls.length).toBe(calls + 1);
    expect(knowledgeReviewPageChars(next.report.pages[0])).toBe(657);
    expect(h.storage.get(`${h.root}/report-precompress.json`)).toEqual(saved);
    expect(h.storage.get(`${h.root}/report.json`).budgetOverflow.after).toEqual([]);
    await compressKnowledgeFinalReport(h.deps as any, h.root, 0, h.digest, h.source, structuredClone(saved));
    expect(h.post.mock.calls.length).toBe(calls + 1);
  });
});

describe("篇幅压缩第一段：确定性去重（零调用）", () => {
  it("与本页图中文字重复的句子、页内重复句、重复图注先被函数删除；函数即达标的页不发模型请求，回执记录删了什么", async () => {
    const h = harness(650);
    const imageText = h.source.pages[0]!.body;
    const imageSentences = imageText.match(/[^。]+。/g)!.slice(0, 60).join("");
    // 审校稿 = 图中已有的 60 句（约 1500 字）+ 本页独有 300 字；独有内容必须原样保留
    const unique = prose(300);
    h.deps.post.mockClear();
    const post = h.post.getMockImplementation()!;
    h.post.mockImplementation(async (request: any) => {
      const res: any = await post(request);
      const env = JSON.parse(res.text); const value = JSON.parse(env.candidates[0].content.parts[0].text);
      if (!request.systemInstruction.parts.some((p: any) => /篇幅压缩/.test(p.text))) value.pages[0].reading.blocks = [{ type: "prose", title: "壁画分期", note: imageSentences.slice(0, 20), text: imageSentences + unique + unique.slice(0, 20) }];
      env.candidates[0].content.parts[0].text = JSON.stringify(value); res.text = JSON.stringify(env); return res;
    });
    const batch = await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps) as any;
    expect(h.calls.map(c => c.kind)).toEqual(["review"]);
    const text = batch.pages[0].reading.blocks[0].text;
    expect(text).toContain(unique);
    expect(text).not.toContain(imageSentences.slice(0, 30));
    expect(knowledgeReviewPageChars(batch.pages[0])).toBeLessThanOrEqual(700);
    const receipt = h.storage.get(`${h.root}/batch-0/compress/deterministic.json`);
    expect(receipt.resolved).toEqual([batch.pages[0].id]);
    expect(receipt.pages[0].removed.some((r: any) => r.kind === "image_sentence")).toBe(true);
    expect(h.storage.get(`${h.root}/batch-0/compress/budget.json`).functionResolved).toEqual([batch.pages[0].id]);
  });
});

describe("篇幅预算写进审校输出合同", () => {
  it("完整版审校请求带逐页 pageBudgets（路由逐页校验）与输出合同文字（目标留 10% 余量）", async () => {
    const h = harness(650);
    await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps);
    const review = h.post.mock.calls[0]![0] as any;
    expect(review.pageBudgets).toEqual([{ id: h.source.pages[0]!.id, headline: h.source.pages[0]!.headline, maxChars: 700 }]);
    expect(review.systemInstruction.parts.some((p: any) => p.text.includes("输出合同·篇幅") && p.text.includes('"targetChars":630'))).toBe(true);
    // 压缩请求按真实上限严格校验（容差 0）：仍超出即由路由切下一跳
    const compress = h.post.mock.calls[1]![0] as any;
    expect(compress.pageBudgets).toEqual([{ id: h.source.pages[0]!.id, headline: h.source.pages[0]!.headline, maxChars: 700 }]);
    expect(compress.budgetTolerance).toBe(0);
  });
});

describe("篇幅容差 B：审校稿容差内收下后由压缩达标", () => {
  it("审校稿超出 ≤15%（路由已收下并标 budgetTolerated）→ 报告记录比例与路径，压缩后每页 ≤ 预算", async () => {
    const h = harness(650);
    const post = h.post.getMockImplementation()!;
    h.post.mockImplementation(async (request: any) => {
      const res: any = await post(request);
      if (request.systemInstruction.parts.some((p: any) => /篇幅压缩/.test(p.text))) return res;
      const env = JSON.parse(res.text); const value = JSON.parse(env.candidates[0].content.parts[0].text);
      value.pages[0].reading.blocks = [{ type: "prose", title: "壁画分期", note: "", text: prose(780) }];
      env.candidates[0].content.parts[0].text = JSON.stringify(value);
      env.budgetTolerated = { tolerance: 0.15, route: "glm-evolink", pages: [{ id: value.pages[0].id, headline: "x", chars: 787, maxChars: 700, excess: 87, ratio: 0.124, path: "tolerated_to_compression" }] };
      res.text = JSON.stringify(env); return res;
    });
    const batch = await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps) as any;
    expect(h.calls.map(c => c.kind)).toEqual(["review", "compress"]);
    expect(knowledgeReviewPageChars(batch.pages[0])).toBeLessThanOrEqual(700);
    const saved = h.storage.get(`${h.root}/batch-0/report.json`);
    expect(saved.budgetTolerated.pages[0].path).toBe("tolerated_to_compression");
    expect(saved.budgetOverflow.after).toEqual([]);
  });
});

describe("压缩目标比例常量", () => {
  it("KNOWLEDGE_COMPRESSION_TARGET_RATIO=0.85：首轮压缩提示词即写 595 字目标，验收按 700（650 字压缩稿收下）", async () => {
    const { KNOWLEDGE_COMPRESSION_TARGET_RATIO } = await import("../../shared/knowledgeEditionBudget");
    expect(KNOWLEDGE_COMPRESSION_TARGET_RATIO).toBe(0.85);
    const h = harness(650);
    const batch = await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps) as any;
    const first = h.post.mock.calls[1]![0] as any;
    expect(first.systemInstruction.parts.some((p: any) => /"maxChars":595/.test(p.text))).toBe(true);
    expect(h.calls.map(c => c.kind)).toEqual(["review", "compress"]);
    expect(knowledgeReviewPageChars(batch.pages[0])).toBe(657);
  });
});


describe("图主文辅合同 image-primary-v1（2026-11-11：主要重点进图，正文只写图中没有的次要重点）", () => {
  it("新稿审校请求带合同全文、建议字数按图外资料给出且注明上限不是目标；旧稿请求逐字不含合同", async () => {
    const fresh = harness(650, { contract: true });
    expect(fresh.source.readingContract).toBe(KNOWLEDGE_READING_CONTRACT);
    await reviewKnowledgePublication(7, { documentId: fresh.doc.id, batchIndex: 0, attempt: 0 }, fresh.deps);
    const text = (fresh.post.mock.calls[0]![0] as any).systemInstruction.parts.map((p: any) => p.text).join("\n");
    expect(text).toContain(KNOWLEDGE_IMAGE_PRIMARY_INSTRUCTIONS);
    expect(text).toContain("maxChars是上限不是目标");
    expect(text).toMatch(/"suggestedChars":\d+/);
    expect(text).not.toContain("按 targetChars 写");
    // 路由仍按真实上限逐页校验；上限来自页数分配（本章图内文字最密，分到跨页 → 420 字）。
    expect((fresh.post.mock.calls[0]![0] as any).pageBudgets[0].maxChars).toBe(knowledgeReadingCharBudgets("full", fresh.source.pages, KNOWLEDGE_READING_CONTRACT).pages[0]!.maxChars);
    const old = harness(650);
    expect(old.source.readingContract).toBeUndefined();
    await reviewKnowledgePublication(7, { documentId: old.doc.id, batchIndex: 0, attempt: 0 }, old.deps);
    const oldText = (old.post.mock.calls[0]![0] as any).systemInstruction.parts.map((p: any) => p.text).join("\n");
    expect(oldText).not.toContain(KNOWLEDGE_IMAGE_PRIMARY_MARKER);
    expect(oldText).toContain("按 targetChars 写");
    expect(oldText.startsWith(KNOWLEDGE_REVIEW_INSTRUCTIONS + "\n" + knowledgeExplanationInstructions("full") + "\n")).toBe(true);
  });

  it("合同字段参与原稿摘要：新稿摘要与去掉字段的同稿不同（新稿新身份），旧稿摘要与旧算法一致", () => {
    const fresh = harness(650, { contract: true }), old = harness(650);
    const { readingContract, ...stripped } = fresh.source;
    expect(readingContract).toBe(KNOWLEDGE_READING_CONTRACT);
    expect(knowledgeSourceDigest(fresh.source)).not.toBe(knowledgeSourceDigest(stripped as any));
    // 旧稿 JSON 不出现该键（layoutFromSource 不写 undefined 键），摘要即旧算法结果。
    expect(Object.keys(old.source)).not.toContain("readingContract");
  });

  it("新稿审校稿未超篇幅也做图文去重：删掉与图中文字相同的句子并留回执，图外内容原样保留；旧稿不动", async () => {
    const run = async (contract: boolean) => {
      const h = harness(650, { contract });
      const imageSentences = h.source.pages[0]!.body.match(/[^。]+。/g)!.slice(0, 6).join("");
      const unique = prose(200);
      const post = h.post.getMockImplementation()!;
      h.post.mockImplementation(async (request: any) => {
        const res: any = await post(request);
        const env = JSON.parse(res.text); const value = JSON.parse(env.candidates[0].content.parts[0].text);
        value.pages[0].reading.blocks = [{ type: "prose", title: "壁画分期", note: "", text: imageSentences + unique }];
        value.pages[0].body = imageSentences + unique;
        env.candidates[0].content.parts[0].text = JSON.stringify(value); res.text = JSON.stringify(env); return res;
      });
      const batch = await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps) as any;
      return { h, batch, imageSentences, unique };
    };
    const fresh = await run(true);
    expect(fresh.h.calls.map(c => c.kind)).toEqual(["review"]);
    const text = fresh.batch.pages[0].reading.blocks[0].text;
    expect(text).toContain(fresh.unique);
    expect(text).not.toContain(fresh.imageSentences.slice(0, 20));
    expect(fresh.batch.pages[0].body).not.toContain(fresh.imageSentences.slice(0, 20));
    const receipt = fresh.h.storage.get(`${fresh.h.root}/batch-0/image-dedupe.json`);
    expect(receipt.pages[0].removed.some((r: any) => r.kind === "image_sentence")).toBe(true);
    const old = await run(false);
    expect(old.batch.pages[0].reading.blocks[0].text).toContain(old.imageSentences);
    expect(old.h.storage.get(`${old.h.root}/batch-0/image-dedupe.json`)).toBeUndefined();
  });

  it("去重不会把一章删空：正文全部与图相同则保留原稿交审校处理", () => {
    const h = harness(650, { contract: true });
    const page = h.source.pages[0]!;
    const same = page.body.match(/[^。]+。/g)!.slice(0, 3).join("");
    const reviewed = [{ id: page.id, headline: page.headline, body: same, imageDescription: "", imageStatus: "consistent" as const, facts: [{ term: "x", statement: "y" }], cautions: [],
      reading: { version: 1 as const, subtitle: "", accent: "jade" as const, blocks: [{ type: "prose" as const, title: "壁画分期", note: "", text: same }] } }];
    const out = dedupeKnowledgeReviewAgainstImages(h.source, reviewed as any);
    expect(out.pages[0]!.body).toBe(same);
    expect(out.removed).toEqual([]);
  });

  it("新稿批次只做零调用去重，不一批一调：超出章留到统稿后整册压缩（≤2 轮）", async () => {
    const h = harness(650, { contract: true });
    const batch = await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps) as any;
    expect(h.calls.map(c => c.kind)).toEqual(["review"]);
    expect(batch.budgetOverflow.after.length).toBeGreaterThan(0);
    // 再读批次也不补发压缩。
    await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps);
    expect(h.calls.map(c => c.kind)).toEqual(["review"]);
  });

  it("新稿统稿后整册压缩：全部超出章同一请求、最多 2 轮（旧稿同一情形可走 4 轮）", async () => {
    const run = async (contract: boolean) => {
      const h = harness([1500, 1200, 1000, 800], { contract });
      const batch = await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps) as any;
      const long = { ...batch.pages[0], reading: { ...batch.pages[0].reading, blocks: [{ type: "prose", title: "壁画分期", note: "", text: prose(1800) }] } };
      const saved = { report: { kind: "knowledge_publication_v1", sourceDigest: h.digest, title: h.source.title, pages: [long] }, sourceImages: [] };
      h.setCompress([1500, 1200, 1000, 800]);
      const before = h.calls.filter(c => c.kind === "compress").length;
      await compressKnowledgeFinalReport(h.deps as any, h.root, 0, h.digest, h.source, structuredClone(saved));
      return h.calls.filter(c => c.kind === "compress").length - before;
    };
    expect(await run(true)).toBe(2);
    expect(await run(false)).toBeGreaterThan(2);
  });
});

describe("整册压缩三章一组、各组并发发出（2026-11-13：全部超出章同一请求会超过整条链约 10 分钟上限；一章一次调用次数太多）", () => {
  const multi = async (h: ReturnType<typeof harness>, count = 7) => {
    const batch = await reviewKnowledgePublication(7, { documentId: h.doc.id, batchIndex: 0, attempt: 0 }, h.deps) as any;
    const pages = h.source.pages.slice(0, count).map((sp: any) => ({ ...batch.pages[0], id: sp.id, headline: sp.headline,
      reading: { ...batch.pages[0].reading, blocks: [{ type: "prose", title: "壁画分期", note: "", text: prose(1800) }] } }));
    const saved = { report: { kind: "knowledge_publication_v1", sourceDigest: h.digest, title: h.source.title, pages }, sourceImages: [] };
    const compressCalls = () => h.calls.filter(c => c.kind === "compress");
    return { saved, ids: pages.map((p: any) => p.id as string), compressCalls, before: compressCalls().length };
  };
  const groupDirs = (h: ReturnType<typeof harness>) => Array.from(new Set(Array.from(h.storage.keys()).filter(k => k.startsWith(`${h.root}/final-compress/group-`) && k.endsWith("/raw-0.json"))));

  it("七章超出 → 三次调用（3+3+1 章），每组回执各在 group-<摘要> 目录；全部达标；再读零调用", async () => {
    const h = harness(400, { contract: true });
    const m = await multi(h);
    const next = await compressKnowledgeFinalReport(h.deps as any, h.root, 0, h.digest, h.source, structuredClone(m.saved));
    const sent = m.compressCalls().slice(m.before);
    expect(sent.map(c => c.ids.length).sort()).toEqual([1, 3, 3]);
    expect(sent.every(c => c.ids.length <= KNOWLEDGE_COMPRESSION_GROUP_CHAPTERS)).toBe(true);
    // 按章序分组，每章恰好出现一次。
    expect(sent.flatMap(c => c.ids).sort()).toEqual([...m.ids].sort());
    expect(sent.find(c => c.ids.length === 3 && c.ids[0] === m.ids[0])!.ids).toEqual(m.ids.slice(0, 3));
    expect(groupDirs(h)).toHaveLength(3);
    expect(h.storage.has(`${h.root}/final-compress/raw-0.json`)).toBe(false);
    expect(next.budgetOverflow.after).toEqual([]);
    expect(next.report.pages.map((p: any) => knowledgeReviewPageChars(p))).toEqual(Array.from({ length: 7 }, () => 407));
    await compressKnowledgeFinalReport(h.deps as any, h.root, 0, h.digest, h.source, structuredClone(m.saved));
    expect(m.compressCalls().length).toBe(m.before + 3);
  });

  it("不多于一组（≤3 章）：仍是一次整批请求", async () => {
    const h = harness(400, { contract: true });
    const m = await multi(h, 3);
    await compressKnowledgeFinalReport(h.deps as any, h.root, 0, h.digest, h.source, structuredClone(m.saved));
    const sent = m.compressCalls().slice(m.before);
    expect(sent.map(c => c.ids)).toEqual([m.ids]);
    expect(h.storage.has(`${h.root}/final-compress/raw-0.json`)).toBe(true);
  });

  it("相邻组首跳走不同路由", async () => {
    const h = harness(400, { contract: true });
    const m = await multi(h, 12);
    const from = h.post.mock.calls.length;
    await compressKnowledgeFinalReport(h.deps as any, h.root, 0, h.digest, h.source, structuredClone(m.saved));
    const sent = h.post.mock.calls.slice(from).map(c => c[0] as any);
    const channelOfFirst = (id: string) => sent.find(r => JSON.parse(r.contents[0].parts.find((p: any) => p.text.includes('"source"')).text).source.pages[0].id === id).executionChannel;
    expect([0, 3, 6, 9].map(i => channelOfFirst(m.ids[i]!))).toEqual(["evolink", "openrouter", "evolink", "openrouter"]);
  });

  it("其中一组失败：其余组照常采纳并落盘，失败组的章保留原稿并报出；不抛错、不挡排版", async () => {
    const h = harness(400, { contract: true });
    const m = await multi(h);
    h.failPages.add(m.ids[4]!);
    const next = await compressKnowledgeFinalReport(h.deps as any, h.root, 0, h.digest, h.source, structuredClone(m.saved));
    expect(next.report.pages.map((p: any) => knowledgeReviewPageChars(p))).toEqual([407, 407, 407, 1807, 1807, 1807, 407]);
    expect(next.budgetOverflow.adopted.sort()).toEqual([m.ids[0], m.ids[1], m.ids[2], m.ids[6]].sort());
    expect(next.budgetOverflow.after.map((o: any) => o.id)).toEqual(m.ids.slice(3, 6));
    expect(next.budgetOverflow.error).toMatch(/^3\/7章压缩未完成/);
  });

  it("新合同全部失败：不抛错，原报告原样返回（超出章按续页进排版），原因记入 budget.json", async () => {
    const h = harness(400, { contract: true });
    const m = await multi(h);
    m.ids.forEach(id => h.failPages.add(id));
    const next = await compressKnowledgeFinalReport(h.deps as any, h.root, 0, h.digest, h.source, structuredClone(m.saved));
    expect(next).toEqual(m.saved);
    const budget = h.storage.get(`${h.root}/final-compress/budget.json`);
    expect(budget.error).toMatch(/^7\/7章压缩未完成/);
    expect(budget.after.length).toBe(7);
  });

  it("旧稿全部失败：仍报错，超出页不进排版", async () => {
    const h = harness(650);
    const m = await multi(h);
    m.ids.forEach(id => h.failPages.add(id));
    await expect(compressKnowledgeFinalReport(h.deps as any, h.root, 0, h.digest, h.source, structuredClone(m.saved))).rejects.toThrow(/整册篇幅压缩未完成/);
  });

  it("已按章发过的回包（1113 首版 page-<章id>）零调用回放，其余章才分组发出", async () => {
    const h = harness(400, { contract: true });
    const m = await multi(h);
    const pageRaw = (p: any) => ({ model: KNOWLEDGE_VISUAL_ADVISOR_MODEL, sourceDigest: h.digest, sourceImages: [], response: { status: 200, text: JSON.stringify({ modelVersion: KNOWLEDGE_VISUAL_ADVISOR_MODEL, usageMetadata: { promptTokensDetails: [] },
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ kind: "knowledge_publication_v1", sourceDigest: h.digest, title: h.source.title, pages: [{ id: p.id, headline: p.headline, body: p.body, imageDescription: "", imageStatus: "absent", facts: p.facts, cautions: [],
        reading: { version: 1, subtitle: "", accent: "jade", blocks: [{ type: "prose", title: "壁画分期", note: "", text: prose(380) }] } }] }) }] } }] }) } });
    h.storage.set(`${h.root}/final-compress/page-${m.ids[1]}/raw-0.json`, pageRaw(m.saved.report.pages[1]));
    const next = await compressKnowledgeFinalReport(h.deps as any, h.root, 0, h.digest, h.source, structuredClone(m.saved));
    const sent = m.compressCalls().slice(m.before);
    expect(sent.flatMap(c => c.ids)).not.toContain(m.ids[1]);
    expect(sent.map(c => c.ids.length).sort()).toEqual([3, 3]);
    expect(knowledgeReviewPageChars(next.report.pages[1])).toBe(387);
  });

  it("该轮已有整批成功回包：零调用回放整批结果，不拆分", async () => {
    const h = harness(400, { contract: true });
    const m = await multi(h);
    const whole = { model: KNOWLEDGE_VISUAL_ADVISOR_MODEL, sourceDigest: h.digest, sourceImages: [], response: { status: 200, text: JSON.stringify({ modelVersion: KNOWLEDGE_VISUAL_ADVISOR_MODEL, usageMetadata: { promptTokensDetails: [] },
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ kind: "knowledge_publication_v1", sourceDigest: h.digest, title: h.source.title, pages: m.saved.report.pages.map((p: any) => ({ id: p.id, headline: p.headline, body: p.body, imageDescription: "", imageStatus: "absent", facts: p.facts, cautions: [],
        reading: { version: 1, subtitle: "", accent: "jade", blocks: [{ type: "prose", title: "壁画分期", note: "", text: prose(380) }] } })) }) }] } }] }) } };
    h.storage.set(`${h.root}/final-compress/raw-0.json`, whole);
    const next = await compressKnowledgeFinalReport(h.deps as any, h.root, 0, h.digest, h.source, structuredClone(m.saved));
    expect(m.compressCalls().length).toBe(m.before);
    expect(next.report.pages.map((p: any) => knowledgeReviewPageChars(p))).toEqual(Array.from({ length: 7 }, () => 387));
  });

  it("该轮整批请求有未闭合回执：不另起分组请求，仍交整批请求处理", async () => {
    const h = harness(400, { contract: true });
    const m = await multi(h);
    h.storage.set(`${h.root}/final-compress/attempt-0/route-openrouter.json`, { state: "unknown", route: "openrouter" });
    await compressKnowledgeFinalReport(h.deps as any, h.root, 0, h.digest, h.source, structuredClone(m.saved));
    const sent = m.compressCalls().slice(m.before);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0]!.ids.length).toBe(7);
  });
});
