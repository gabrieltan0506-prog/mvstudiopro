import { describe, it, expect, vi } from "vitest";
vi.mock("./gcs", async importOriginal => ({ ...await importOriginal<any>(), getGcsBucketName: () => "test" }));
import { layoutFromSource } from "../../shared/editableLayout";
import { KNOWLEDGE_SPREAD_PAGE_CHARS } from "../../shared/knowledgeHandbookPagePlan";
import { KNOWLEDGE_VISUAL_ADVISOR_MODEL, knowledgeReviewPageChars } from "./knowledgePublicationAdvisor";
import { refitKnowledgeHandbook, KNOWLEDGE_REFIT_MAX_ROUNDS } from "./knowledgeHandbookRefit";

// 每句互不相同，便于确认没有截断。
const prose = (chars: number, tag: string) => { let out = "", k = 0; while (out.length < chars) out += `${tag}第${k++}句说明背景与注意事项。`; return out; };
const visible = (s: string) => s.replace(/\s+/g, "").length;

function fixture(options: { stubborn?: number[]; dropPage?: boolean; spreadPages?: number } = {}) {
  const n = 8;
  // 前 4 章图内文字最密 → 4 个跨页名额（8 图目标 12 页）；正文都偏长，需要压缩。
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
  // 预分页替身：从片段里取本章正文字数与版式；跨页放得下 450 字，图文同页 1 页放 700 字。
  const measure = vi.fn(async (html: string) => {
    const id = html.match(/data-source-id="([^"]+)"/)![1]!, mode = html.match(/data-image-mode="([a-z]+)"/)![1]!;
    const source = html.slice(html.indexOf('id="reading-source"'), html.indexOf("<script>"));
    const chars = visible(source.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "x"));
    const fitsSpread = mode === "spread" && chars <= 450;
    const pages = fitsSpread ? options.spreadPages ?? 2 : Math.max(1, Math.ceil(chars / 700));
    return { pages, booklets: [{ pages, imageModes: { [id]: fitsSpread ? "spread" : "inline" }, maxWhitespace: 0.1 }] };
  });
  return { doc, review, view, storage, post, measure, requests, advisor, deps: { advisor, measure, imageUrl: async (uri: string) => `https://test.invalid/${encodeURIComponent(uri)}` } };
}

describe("压缩适配：LLM 把正文压进版面，全书 ≤2 轮、每轮一章一次并发调用", () => {
  it("超出章一章一次请求并发压缩；实测仍超的章再压一轮；跨页章落进跨页、其余图文同页；原稿与已确认正文不动", async () => {
    const f = fixture();
    const before = structuredClone(f.view.doc);
    const result = await refitKnowledgeHandbook(7, f.view as any, f.deps);
    expect(result.summary.rounds.length).toBeLessThanOrEqual(KNOWLEDGE_REFIT_MAX_ROUNDS);
    // 第一轮 8 章都超：一章一次请求（2026-11-13：全部放进同一请求会超过整条链时限），每次只带本章与本章目标。
    const first = f.requests.slice(0, 8);
    expect(first.every(r => r.ids.length === 1 && r.targets.length === 1 && r.targets[0]!.id === r.ids[0])).toBe(true);
    expect(first.map(r => r.ids[0]).sort()).toEqual(f.doc.pages.map(p => p.id).sort());
    expect(first.filter(r => r.targets[0]!.maxChars <= KNOWLEDGE_SPREAD_PAGE_CHARS)).toHaveLength(4);
    expect(result.summary.rounds[0]!.calls).toBe(8);
    expect(result.summary.compressedChapters).toBe(8);
    expect(result.summary.modelCalls).toBe(f.post.mock.calls.length);
    expect((result.summary.rounds[0]!.usage as any[]).map(u => u.usage)).toEqual(Array.from({ length: 8 }, () => ({ promptTokenCount: 1000, candidatesTokenCount: 500 })));
    // 回填闭合：章 id 与顺序不变，每章都有正文。
    expect(result.view.doc.pages.map(p => p.id)).toEqual(before.pages.map(p => p.id));
    expect(result.view.doc.pages.every(p => p.body.includes("压缩"))).toBe(true);
    expect(result.imageModes).toEqual(["spread", "spread", "spread", "spread", "inline", "inline", "inline", "inline"]);
    expect(result.summary.spreadChapters).toBe(4);
    expect(result.summary.totalPages).toBe(12);
    expect(result.summary.charsAfter).toBeLessThan(result.summary.charsBefore);
    // 原稿未改；派生正文与原文同存，可回退。
    expect(f.view.doc).toEqual(before);
    const derived = f.storage.get(`${result.evidencePrefix}/derived.json`);
    expect(derived.pages.map((p: any) => p.original)).toEqual(before.pages.map(p => p.body));
    expect(derived.pages.map((p: any) => p.derived)).toEqual(result.view.doc.pages.map(p => p.body));
    expect(result.prefixTag).toMatch(/^refit-[0-9a-f]{16}$/);
    // 原始回包永久保存。
    expect(Array.from(f.storage.keys()).filter(k => k.startsWith(`${result.evidencePrefix}/round-1/page-`) && k.endsWith("/raw-0.json"))).toHaveLength(8);
    // 再跑一次：已有回包零调用回放，结果一致。
    const again = await refitKnowledgeHandbook(7, f.view as any, f.deps);
    expect(f.post.mock.calls.length).toBe(result.summary.modelCalls);
    expect(again.view.doc.pages.map(p => p.body)).toEqual(result.view.doc.pages.map(p => p.body));
  });

  it("压两轮后仍超出的章排成续页并报出，正文不截断；第二轮只送仍超的章", async () => {
    const f = fixture({ stubborn: [5] });
    const stubbornId = f.doc.pages[5]!.id;
    const result = await refitKnowledgeHandbook(7, f.view as any, f.deps);
    // 第一轮 8 章各一次；第二轮只送仍超的那一章。
    expect(f.post.mock.calls.length).toBe(9);
    expect(f.requests[8]!.ids).toEqual([stubbornId]);
    const page = result.view.doc.pages.find(p => p.id === stubbornId)!;
    // 第 6 章顽固：两轮后仍 > 700 字 → 续页（2 页），报出且全文保留（句子完整、比上限长，没有被裁到上限）。
    expect(result.summary.overflowChapters.map(c => c.id)).toEqual([stubbornId]);
    expect(page.body.endsWith("。")).toBe(true);
    expect(visible(page.body)).toBeGreaterThan(700);
    // 续页让总数到 13 > 上限 12：先收 1 个跨页名额，回到 12。
    expect(result.summary.totalPages).toBe(12);
    expect(result.summary.retractedSpreads).toBe(1);
  });

  it("模型漏回章节：回填不闭合即不采纳该轮，保留原文并记录错误，不抛出", async () => {
    const f = fixture({ dropPage: true });
    const result = await refitKnowledgeHandbook(7, f.view as any, f.deps);
    expect(result.summary.rounds[0]!.error).toBeTruthy();
    expect(result.view.doc.pages.map(p => p.body)).toEqual(f.view.doc.pages.map(p => p.body));
    // 每轮每章至多一次请求，全书至多两轮。
    expect(result.summary.rounds.length).toBeLessThanOrEqual(KNOWLEDGE_REFIT_MAX_ROUNDS);
    expect(f.post.mock.calls.length).toBeLessThanOrEqual(8 * KNOWLEDGE_REFIT_MAX_ROUNDS);
  });

  it("实测总页数超过上限：先收跨页名额（图内文字最少的跨页章先改图文同页），不再加调用", async () => {
    const f = fixture({ spreadPages: 3 });
    const result = await refitKnowledgeHandbook(7, f.view as any, f.deps);
    expect(result.summary.totalPages).toBeLessThanOrEqual(result.plan.range!.max);
    expect(result.summary.retractedSpreads).toBeGreaterThan(0);
    expect(result.summary.rounds.length).toBeLessThanOrEqual(KNOWLEDGE_REFIT_MAX_ROUNDS);
  });
});
