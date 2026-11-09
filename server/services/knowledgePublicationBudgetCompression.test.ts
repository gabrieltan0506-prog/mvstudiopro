import { describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ jobs: new Map<string, any>() }));
vi.mock("../jobs/repository", async importOriginal => ({ ...await importOriginal<any>(), getJobByIdStrict: vi.fn(async (id: string) => state.jobs.get(id) || null) }));
vi.mock("./gcs", async importOriginal => ({ ...await importOriginal<any>(), getGcsBucketName: () => "test", signGsUriV4ReadUrl: (uri: string) => uri.replace("gs://", "https://storage.googleapis.com/") }));
vi.mock("./postProdMediaSource", async importOriginal => ({ ...await importOriginal<any>(), loadSucceededJobOutputSources: async () => ({ objects: new Set(), urls: new Set() }), resolveRegisteredPostProdMediaSource: async ({ source }: { source: string }) => source.replace("https://storage.googleapis.com/", "gs://") }));
import { synchronizedKnowledgeCardSource } from "../../shared/knowledgeCardEditableLayout";
import { layoutFromSource } from "../../shared/editableLayout";
import { compileKnowledgeEditions } from "../../shared/knowledgeCardEdition";
import { knowledgeEditionImagePlan } from "../../shared/knowledgeCardPagination";
import { KNOWLEDGE_LEAD_PAGE_CHARS } from "../../shared/knowledgeEditionBudget";
import { compressKnowledgeFinalReport, reviewKnowledgePublication, knowledgeSourceDigest, knowledgeEvidencePrefix, knowledgeReviewPageChars, KNOWLEDGE_VISUAL_ADVISOR_MODEL } from "./knowledgePublicationAdvisor";

const sentence = (i: number, j: number) => `第${i}节第${j}句记述一件具体史实，以及它前后的经过与影响。`;
const book = compileKnowledgeEditions("敦煌测试", Array.from({ length: 12 }, (_, i) => ({
  headline: `原小节${i}`, body: Array.from({ length: 40 }, (_, j) => sentence(i, j)).join(""), priority: "primary" as const,
})));
// 每句互不相同（确定性去重只删重复句，不应影响模型稿的字数断言）。
const prose = (chars: number) => Array.from({ length: Math.ceil(chars / 10) + 1 }, (_, i) => `壁画${String(i).padStart(4, "0")}年代考。`).join("").slice(0, chars);

function harness(initial: number | "fail" | (number | "fail")[]) {
  let compressChars: number | "fail" | (number | "fail")[] = initial;
  let compressCalls = 0;
  state.jobs.clear();
  const plan = knowledgeEditionImagePlan(book.full)!;
  const imageJobIds = plan.images.map((_, i) => `img-job-${i}`);
  imageJobIds.forEach((id, i) => state.jobs.set(id, { userId: "7", status: "succeeded", input: { action: "platform_composite_sheet_progress", params: { kind: "single_page_knowledge_card" } }, output: { compositeImageUrl: `https://storage.googleapis.com/test/${i}.png` } }));
  const doc = layoutFromSource(synchronizedKnowledgeCardSource({ owner: "7", sourceId: "dh", fullMarkdown: book.full, illustrationMarkdown: book.full, detailLevel: "full", imageJobIds }));
  const source = doc.publication!.source, digest = knowledgeSourceDigest(source), storage = new Map<string, any>(), sha = "b".repeat(64);
  const calls: { kind: "review" | "compress"; ids: string[] }[] = [];
  const post = vi.fn(async (request: any) => {
    const payload = request.contents[0].parts.map((p: any) => { try { return JSON.parse(p.text); } catch { return {}; } }).find((p: any) => p.source);
    const compress = request.systemInstruction.parts.some((p: any) => /篇幅压缩/.test(p.text));
    calls.push({ kind: compress ? "compress" : "review", ids: payload.source.pages.map((p: any) => p.id) });
    const planned = Array.isArray(compressChars) ? compressChars[Math.min(compressCalls, compressChars.length - 1)] : compressChars;
    if (compress) compressCalls++;
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
  return { setCompress: (v: number | "fail" | (number | "fail")[]) => { compressChars = v; compressCalls = 0; }, doc, source, digest, storage, post, calls, deps, root: knowledgeEvidencePrefix(7, doc.id, doc.publication!.requestId) };
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
    // 第二轮目标留 8% 余量
    const second = h.post.mock.calls[2]![0] as any;
    expect(second.systemInstruction.parts.some((p: any) => /"maxChars":644/.test(p.text))).toBe(true);
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
