import { describe, expect, it } from "vitest";
import { compileKnowledgeEditions } from "./knowledgeCardEdition";
import { knowledgeEditionIllustratedPages, planKnowledgeCardPages } from "./knowledgeCardPagination";
import { knowledgeLayoutLibraryOversize, knowledgeLayoutSourceOversize, synchronizedKnowledgeCardSource } from "./knowledgeCardEditableLayout";
import { layoutFromSource, layoutLibrarySchema } from "./editableLayout";
import { knowledgeSourceSchema, KNOWLEDGE_SUPPLEMENT_MAX_CHARS } from "./knowledgePublication";

// 复现 2026-11-20「写完暂存清单后 0 个出图任务」：约 340 万字、4208 章节的两档稿，完整版 48 张图。
const para = "司马光记述此事时，先叙其始末，再论其得失；诸侯之间的盟约、兵力与粮道皆有详载，读者可据此判断形势的转折与因果。";
const modules = Array.from({ length: 4208 }, (_, i) => ({ headline: `卷${Math.floor(i / 14) + 1}·事件${i + 1}`, body: Array.from({ length: 3 + (i % 9) }, (_, k) => (k % 3 === 0 ? "- " : "") + para.repeat(1 + (k + i) % 3)).join("\n\n"), priority: (i % 6 === 0 ? "primary" : "secondary") as "primary" | "secondary" }));
const { full } = compileKnowledgeEditions("资治通鉴", modules);
const timed = <T,>(label: string, f: () => T, times: Record<string, number>) => { const t = performance.now(); const v = f(); times[label] = Math.round(performance.now() - t); return v; };

describe("大稿出图前准备链", () => {
  it("完整版 48 图、个别章图外内文超 5 万字：整理与表结构校验不再整册失败，每步 <1 秒", () => {
    const times: Record<string, number> = {};
    expect(full.length).toBeGreaterThan(3_300_000);
    const plan = timed("plan", () => planKnowledgeCardPages(full), times);
    const pages = knowledgeEditionIllustratedPages(full)!;
    expect(plan.pages.length).toBe(48);
    expect(Math.max(...pages.map(p => p.supplement?.length || 0))).toBeGreaterThan(50_000);
    const source = timed("sync", () => synchronizedKnowledgeCardSource({ owner: "7", sourceId: "knowledge-card:x", fullMarkdown: full, illustrationMarkdown: full, detailLevel: "full", imageJobIds: plan.pages.map((_, i) => `kc_${i}`) }), times);
    expect(knowledgeLayoutSourceOversize(source)).toBeNull();
    const doc = timed("layoutFromSource", () => layoutFromSource(source), times);
    const library = timed("librarySchema", () => layoutLibrarySchema.parse({ version: 1, owner: "7", documents: [doc] }), times);
    const bytes = timed("bytes", () => new TextEncoder().encode(JSON.stringify({ library })).length, times);
    expect(knowledgeLayoutLibraryOversize(bytes)).toBeNull();
    console.log("大稿准备链耗时(ms)", times, "整库字节", bytes);
    // 单步本机实测均 <1 秒；断言留余量防 CI 抖动
    for (const ms of Object.values(times)) expect(ms).toBeLessThan(2000);
  }, 30_000);

  it("超出新上限的章：出图前给出哪一章、多少字、怎么办的中文提示（不含模型名）", () => {
    const source = { kind: "knowledge-publication" as const, detailLevel: "concise" as const, owner: "7", sourceId: "s", title: "书", body: "x", pages: [
      { pageIndex: 1, headline: "甲章", body: "正文", supplement: "字".repeat(KNOWLEDGE_SUPPLEMENT_MAX_CHARS + 1) },
      { pageIndex: 2, headline: "乙章", body: "正文", supplement: "字".repeat(60_000) },
    ] };
    const msg = knowledgeLayoutSourceOversize(source)!;
    expect(msg).toMatch(/第 1 章「甲章」图外内文 400,001 字/);
    expect(msg).toMatch(/^精华版出图前检查未通过/);
    expect(msg).toMatch(/未扣费/);
    expect(msg).toMatch(/改用完整版/);
    expect(msg).not.toMatch(/乙章/);
    expect(knowledgeLayoutLibraryOversize(65 * 1024 * 1024)).toMatch(/超过 64MB/);
  });

  it("旧稿（≤5 万字）解析结果逐字不变", () => {
    const old = { title: "书", pages: [{ id: crypto.randomUUID(), headline: "章", body: "正文", supplement: "补".repeat(50_000), imageUrl: "" }] };
    expect(JSON.stringify(knowledgeSourceSchema.parse(old))).toBe(JSON.stringify(old));
  });
});
