import { describe, it, expect, vi } from "vitest";
vi.mock("./gcs", async importOriginal => ({ ...await importOriginal<any>(), getGcsBucketName: () => "test" }));
import { layoutFromSource } from "../../shared/editableLayout";
import { KNOWLEDGE_COMPRESSION_TARGET_RATIO, KNOWLEDGE_LEAD_PAGE_CHARS } from "../../shared/knowledgeEditionBudget";
import { KNOWLEDGE_VISUAL_ADVISOR_MODEL, knowledgeReviewPageChars } from "./knowledgePublicationAdvisor";
import { refitKnowledgeHandbook, KNOWLEDGE_REFIT_MAX_ROUNDS } from "./knowledgeHandbookRefit";

// 每句互不相同，便于确认没有截断。
const prose = (chars: number, tag: string) => { let out = "", k = 0; while (out.length < chars) out += `${tag}第${k++}句说明背景与注意事项。`; return out; };
const visible = (s: string) => s.replace(/\s+/g, "").length;

function fixture(options: { stubborn?: number[]; dropPage?: boolean } = {}) {
  const n = 8;
  // 8 图完整版：页数区间 12–12（只作上限校核）；前 4 章图内文字最密（2026-11-13 起不再据此分跨页）；正文都偏长，需要压缩。
  const doc = layoutFromSource({ kind: "knowledge-publication", detailLevel: "full", owner: "7", sourceId: "refit", title: "网文副业入门", body: "",
    pages: Array.from({ length: n }, (_, i) => ({ headline: `第${i + 1}章`, body: prose(i % 3 === 0 ? 1300 : 900, `章${i + 1}`), pageIndex: i + 1 })),
    images: Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, `gs://test/${i}.png`])) });
  doc.publication!.source.pages.forEach((p, i) => { p.body = "图内".repeat(i < 4 ? 500 : 50); });
  const review: any = { kind: "knowledge_publication_v1", sourceDigest: "d".repeat(64), title: doc.title, pages: doc.pages.map(p => ({ id: p.id, headline: p.headline, body: p.body, imageDescription: "测试配图", imageStatus: "consistent", facts: [{ term: "签约", statement: "签约是收入入口" }], cautions: [], reading: { version: 1, subtitle: "", accent: "jade", blocks: [{ type: "prose", title: "旧", note: "", text: p.body }] } })) };
  const view = { doc, review, receipt: { sourceImages: [] }, prefix: "knowledge-publications/user-7/doc/exports/abc" };
  const storage = new Map<string, any>();
  const requests: { ids: string[]; targets: { id: string; maxChars: number }[] }[] = [];
  const post = vi.fn(async (request: any) => {
    const payload = request.contents[0].parts.map((p: any) => { try { return JSON.parse(p.text); } catch { return {}; } }).find((p: any) => p.source);
    const system = request.systemInstruction.parts.map((p: any) => p.text).join("\n");
    const targets = JSON.parse(system.match(/各页目标：(\[[^\n]*?\])(?:\n|$)/)![1]!);
    requests.push({ ids: payload.source.pages.map((p: any) => p.id), targets });
    const pages = payload.source.pages.filter((_: any, i: number) => !(options.dropPage && i === 0)).map((page: any) => {
      const target = targets.find((t: any) => t.id === page.id)!.maxChars;
      // 顽固章：模型只删了一点，仍超出（用来验证续页与不截断）。
      const text = options.stubborn?.some(i => doc.pages[i]!.id === page.id) ? prose(Math.floor(visible(page.body) * 0.95), "顽固") : prose(Math.max(60, target - 40), "压缩");
      return { id: page.id, headline: page.headline, body: text, imageDescription: "", imageStatus: "absent", facts: [{ term: "签约", statement: "签约是收入入口" }], cautions: [],
        reading: { version: 1, subtitle: "", accent: "jade", blocks: [{ type: "prose", title: "要点", note: "", text }] } };
    });
    const value = { kind: "knowledge_publication_v1", sourceDigest: payload.sourceDigest, title: payload.source.title, pages };
    return { status: 200, text: JSON.stringify({ modelVersion: KNOWLEDGE_VISUAL_ADVISOR_MODEL, gateway: "test", usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 }, candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] }) };
  });
  const advisor: any = { read: async (k: string) => storage.get(k) ?? null, save: async (k: string, v: any) => { storage.set(k, structuredClone(v)); }, post, count: async () => ({ totalTokens: 100, method: "test" }), load: async () => doc, image: async () => { throw Error("压缩适配不应读图"); } };
  // 预分页替身：从片段里取本章正文字数与版式；图文同页 1 页放 700 字，多出的排续页。记下送测版式，验证不再有跨页。
  const sentModes: string[] = [];
  const measure = vi.fn(async (html: string) => {
    const id = html.match(/data-source-id="([^"]+)"/)![1]!, mode = html.match(/data-image-mode="([a-z]+)"/)![1]!;
    sentModes.push(mode);
    const source = html.slice(html.indexOf('id="reading-source"'), html.indexOf("<script>"));
    const chars = visible(source.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "x"));
    const pages = Math.max(1, Math.ceil(chars / 700));
    return { pages, booklets: [{ pages, imageModes: { [id]: "inline" }, maxWhitespace: 0.1 }] };
  });
  return { doc, review, view, storage, post, measure, sentModes, requests, advisor, deps: { advisor, measure, imageUrl: async (uri: string) => `https://test.invalid/${encodeURIComponent(uri)}` } };
}

describe("压缩适配：LLM 把正文压进版面，全书 ≤2 轮、每轮三章一组并发调用", () => {
  it("超出章三章一组并发压缩；无跨页、全部图文同页、预算统一 700；原稿与已确认正文不动", async () => {
    const f = fixture();
    const before = structuredClone(f.view.doc);
    const result = await refitKnowledgeHandbook(7, f.view as any, f.deps);
    expect(result.summary.rounds.length).toBeLessThanOrEqual(KNOWLEDGE_REFIT_MAX_ROUNDS);
    // 第一轮 8 章都超：三章一组、各组并发（3+3+2），每次只带本组的章与各自目标（2026-11-13）。
    const first = f.requests.slice(0, 3);
    expect(first.map(r => r.ids.length).sort()).toEqual([2, 3, 3]);
    expect(first.every(r => r.targets.map(t => t.id).join() === r.ids.join())).toBe(true);
    expect(first.flatMap(r => r.ids).sort()).toEqual(f.doc.pages.map(p => p.id).sort());
    // 不再切图：每章预算统一为图文同页档 700（请求目标 = 预算 × 压缩目标比），没有 420 字跨页档。
    expect(first.every(r => r.targets.every(t => t.maxChars === Math.floor(KNOWLEDGE_LEAD_PAGE_CHARS * KNOWLEDGE_COMPRESSION_TARGET_RATIO)))).toBe(true);
    expect(result.plan.spreadSlots).toBe(0);
    expect(result.plan.chapters.every(c => c.mode === "inline" && c.maxChars === KNOWLEDGE_LEAD_PAGE_CHARS)).toBe(true);
    expect(result.summary.rounds[0]!.calls).toBe(3);
    expect(result.summary.compressedChapters).toBe(8);
    expect(result.summary.modelCalls).toBe(f.post.mock.calls.length);
    expect((result.summary.rounds[0]!.usage as any[]).map(u => u.usage)).toEqual(Array.from({ length: 3 }, () => ({ promptTokenCount: 1000, candidatesTokenCount: 500 })));
    // 回填闭合：章 id 与顺序不变，每章都有正文。
    expect(result.view.doc.pages.map(p => p.id)).toEqual(before.pages.map(p => p.id));
    expect(result.view.doc.pages.every(p => p.body.includes("压缩"))).toBe(true);
    expect(result.imageModes).toEqual(Array.from({ length: 8 }, () => "inline"));
    expect(f.sentModes.length).toBeGreaterThan(0);
    expect(f.sentModes.every(m => m === "inline")).toBe(true);
    expect(result.summary.spreadSlots).toBe(0);
    expect(result.summary.spreadChapters).toBe(0);
    expect(result.summary.retractedSpreads).toBe(0);
    // 页数区间口径不变（8 图 → 12–12，≤72）；每章 1 页 → 8 页，低于下限不凑页。
    expect(result.summary.range).toEqual({ min: 12, max: 12, target: 12 });
    expect(result.summary.totalPages).toBe(8);
    expect(result.summary.overflowChapters).toEqual([]);
    expect(result.summary.charsAfter).toBeLessThan(result.summary.charsBefore);
    // 原稿未改；派生正文与原文同存，可回退。
    expect(f.view.doc).toEqual(before);
    const derived = f.storage.get(`${result.evidencePrefix}/derived.json`);
    expect(derived.pages.map((p: any) => p.original)).toEqual(before.pages.map(p => p.body));
    expect(derived.pages.map((p: any) => p.derived)).toEqual(result.view.doc.pages.map(p => p.body));
    expect(result.prefixTag).toMatch(/^refit-[0-9a-f]{16}$/);
    // 原始回包永久保存。
    expect(Array.from(f.storage.keys()).filter(k => k.startsWith(`${result.evidencePrefix}/round-1/group-`) && k.endsWith("/raw-0.json"))).toHaveLength(3);
    // 再跑一次：已有回包零调用回放，结果一致。
    const again = await refitKnowledgeHandbook(7, f.view as any, f.deps);
    expect(f.post.mock.calls.length).toBe(result.summary.modelCalls);
    expect(again.view.doc.pages.map(p => p.body)).toEqual(result.view.doc.pages.map(p => p.body));
  });

  it("压两轮后仍超出的章排成续页并报出，正文不截断；第二轮只送仍超的章", async () => {
    const f = fixture({ stubborn: [5] });
    const stubbornId = f.doc.pages[5]!.id;
    const result = await refitKnowledgeHandbook(7, f.view as any, f.deps);
    // 第一轮 8 章分三组；第二轮只送仍超的那一章。
    expect(f.post.mock.calls.length).toBe(4);
    expect(f.requests[3]!.ids).toEqual([stubbornId]);
    const page = result.view.doc.pages.find(p => p.id === stubbornId)!;
    // 第 6 章顽固：两轮后仍 > 700 字 → 续页（2 页），报出且全文保留（句子完整、比上限长，没有被裁到上限）。
    expect(result.summary.overflowChapters).toEqual([{ id: stubbornId, headline: page.headline, pages: 2, mode: "inline" }]);
    expect(page.body.endsWith("。")).toBe(true);
    expect(visible(page.body)).toBeGreaterThan(KNOWLEDGE_LEAD_PAGE_CHARS);
    // 第二轮目标按实测换算，不高于图文同页档。
    expect(f.requests[3]!.targets[0]!.maxChars).toBeLessThanOrEqual(KNOWLEDGE_LEAD_PAGE_CHARS);
    // 7 章各 1 页 + 顽固章 2 页（续页）= 9；无跨页可收。
    expect(result.summary.totalPages).toBe(9);
    expect(result.summary.retractedSpreads).toBe(0);
    expect(result.imageModes.every(m => m === "inline")).toBe(true);
  });

  it("模型漏回章节：回填不闭合即不采纳该轮，保留原文并记录错误，不抛出", async () => {
    const f = fixture({ dropPage: true });
    const result = await refitKnowledgeHandbook(7, f.view as any, f.deps);
    expect(result.summary.rounds[0]!.error).toBeTruthy();
    expect(result.view.doc.pages.map(p => p.body)).toEqual(f.view.doc.pages.map(p => p.body));
    // 每轮三章一组（8 章 → 3 次请求），全书至多两轮。
    expect(result.summary.rounds.length).toBeLessThanOrEqual(KNOWLEDGE_REFIT_MAX_ROUNDS);
    expect(f.post.mock.calls.length).toBeLessThanOrEqual(3 * KNOWLEDGE_REFIT_MAX_ROUNDS);
  });

  it("实测总页数超过上限：无跨页名额可收，如实报出续页与总页数，不截断、不加调用", async () => {
    const f = fixture({ stubborn: [0, 1, 2, 3, 4, 5, 6, 7] });
    const result = await refitKnowledgeHandbook(7, f.view as any, f.deps);
    expect(result.summary.totalPages).toBe(16);
    expect(result.summary.totalPages).toBeGreaterThan(result.plan.range!.max);
    expect(result.summary.retractedSpreads).toBe(0);
    expect(result.summary.spreadChapters).toBe(0);
    expect(result.imageModes.every(m => m === "inline")).toBe(true);
    expect(result.summary.overflowChapters).toHaveLength(8);
    expect(result.view.doc.pages.every(p => p.body.endsWith("。") && visible(p.body) > KNOWLEDGE_LEAD_PAGE_CHARS)).toBe(true);
    expect(result.summary.rounds.length).toBeLessThanOrEqual(KNOWLEDGE_REFIT_MAX_ROUNDS);
    // 两轮各三组（3+3+2 章）。
    expect(f.post.mock.calls.length).toBe(6);
  });
});
