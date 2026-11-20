import { describe, expect, it } from "vitest";
import { compileKnowledgeEditions, knowledgeModulesFromMarkdown, knowledgeEditionParts } from "./knowledgeCardEdition";
import { knowledgeEditionIllustratedPages, knowledgeEditionImagePlan, planKnowledgeCardPages } from "./knowledgeCardPagination";
import { knowledgeLayoutLibraryOversize, knowledgeLayoutSourceOversize, synchronizedKnowledgeCardSource } from "./knowledgeCardEditableLayout";
import { layoutFromSource, layoutLibrarySchema } from "./editableLayout";
import { knowledgeSourceSchema, KNOWLEDGE_SUPPLEMENT_MAX_CHARS } from "./knowledgePublication";
import { attachKnowledgeTextModules, attachKnowledgeTextModulesInBookOrder } from "./knowledgeTextAttachment";

// 测试稿一律走正式解析：Markdown → knowledgeModulesFromMarkdown → compileKnowledgeEditions；原稿最后经 knowledgeSourceSchema / layoutLibrarySchema 校验。
const para = (i: number, k: number) => `第${i}节第${k}段：司马光记述此事时，先叙其始末，再论其得失；诸侯之间的盟约、兵力与粮道皆有详载（卷${i % 97}），读者可据此判断形势的转折与因果，并对照前后各卷的人物与制度沿革${k}。`;
function book(sections: number, primary: (i: number) => boolean) {
  const md = "# 资治通鉴\n\n" + Array.from({ length: sections }, (_, i) =>
    `## ${primary(i) ? "主要重点" : "次要重点"}｜卷${Math.floor(i / 14) + 1}·事件${i + 1}\n\n` + Array.from({ length: 3 + (i % 9) }, (_, k) => para(i, k)).join("\n\n")).join("\n\n");
  const parsed = knowledgeModulesFromMarkdown(md);
  return { ...compileKnowledgeEditions(parsed.title, parsed.modules), chars: md.length };
}
const small = book(16, i => i % 4 === 0);
const big = book(3200, i => i % 6 === 0);
// 选节集中在开头（最坏情况）：三千多个未选章节在原书里都排在最后一张图之后。
const skewed = book(3200, i => i < 180 && i % 6 === 0);

/** 改动前的构造（逐字照抄旧实现），用于等价对照。 */
function legacyPages(markdown: string) {
  const plan = knowledgeEditionImagePlan(markdown)!;
  const texts = plan.textModules.filter(m => m.body.trim());
  const attached = attachKnowledgeTextModules(plan.images.map(image => `${image.body}\n\n${image.overflow}`), texts);
  return plan.images.map((image, i) => ({ body: image.body, headline: image.readingTitle, imageTitle: image.title,
    supplement: [image.overflow, attached[i]].filter(part => part?.trim()).join("\n\n") }));
}

function prepare(markdown: string, level: "full" | "concise") {
  const times: Record<string, number> = {};
  const timed = <T,>(label: string, f: () => T) => { const t = performance.now(); const v = f(); times[label] = Math.round(performance.now() - t); return v; };
  const plan = timed("plan", () => planKnowledgeCardPages(markdown));
  const source = timed("sync", () => synchronizedKnowledgeCardSource({ owner: "7", sourceId: `knowledge-card:${level}`, fullMarkdown: markdown, illustrationMarkdown: markdown,
    detailLevel: level, imageJobIds: plan.pages.map((_, i) => `kc_${i}`) }));
  const oversize = knowledgeLayoutSourceOversize(source);
  const doc = timed("layoutFromSource", () => layoutFromSource(source));
  const parsed = timed("sourceSchema", () => knowledgeSourceSchema.parse(doc.publication!.source));
  const library = timed("librarySchema", () => layoutLibrarySchema.parse({ version: 1, owner: "7", documents: [doc] }));
  const bytes = new TextEncoder().encode(JSON.stringify({ library })).length;
  return { plan, source, oversize, parsed, bytes, times };
}

/** 全部文字模块（正文非空）在各页 supplement 里恰好出现一次。 */
function expectAllTextKept(markdown: string, supplements: string[]) {
  const joined = supplements.join("\n\n");
  const texts = knowledgeEditionParts(markdown)!.modules.filter(m => m.medium === "text" && m.body.trim());
  for (const t of texts) {
    const block = `### ${t.headline}\n\n${t.body.trim()}`;
    const at = joined.indexOf(block);
    expect(at, t.headline).toBeGreaterThanOrEqual(0);
    expect(joined.indexOf(block, at + 1), t.headline).toBe(-1);
  }
}

describe("精华版文字归属：大小书都能从两档成稿走到原稿校验", () => {
  it("规模：大书三千二百节、原文两百多万字", () => {
    expect(big.chars).toBeGreaterThan(2_000_000);
    expect(knowledgeEditionParts(big.concise)!.modules.filter(m => m.medium === "text").length).toBeGreaterThan(2600);
  });

  for (const [name, b] of [["小书 16 节", small], ["大书 3200 节", big], ["大书选节集中在开头", skewed]] as const) {
    for (const level of ["concise", "full"] as const) {
      it(`${name} · ${level === "concise" ? "精华版" : "完整版"}：出图前检查通过、原稿 schema 通过、文字一字不丢`, () => {
        const markdown = b[level];
        const r = prepare(markdown, level);
        expect(r.oversize).toBeNull();
        expect(r.parsed.pages.length).toBe(r.plan.pages.length);
        for (const page of r.parsed.pages) expect((page.supplement || "").length).toBeLessThanOrEqual(KNOWLEDGE_SUPPLEMENT_MAX_CHARS);
        expect(knowledgeLayoutLibraryOversize(r.bytes)).toBeNull();
        expectAllTextKept(markdown, r.parsed.pages.map(p => p.supplement || ""));
        console.log(name, level, "图", r.plan.pages.length, "最大单页", Math.max(...r.parsed.pages.map(p => (p.supplement || "").length)), "库字节", r.bytes, r.times);
      }, 60_000);
    }
  }

  it("旧稿等价：旧算法每页都在上限内的稿（小书两档、大书完整版）归属结果逐字不变", () => {
    for (const markdown of [small.concise, small.full, big.full, skewed.full])
      expect(JSON.stringify(knowledgeEditionIllustratedPages(markdown))).toBe(JSON.stringify(legacyPages(markdown)));
  }, 60_000);

  it("只有旧算法超限的稿才换算法：大书精华版旧算法单页超上限（过去在出图前即被拒、从未保存）", () => {
    for (const markdown of [big.concise, skewed.concise]) {
      const legacy = legacyPages(markdown);
      expect(Math.max(...legacy.map(p => p.supplement.length))).toBeGreaterThan(KNOWLEDGE_SUPPLEMENT_MAX_CHARS);
      const pages = knowledgeEditionIllustratedPages(markdown)!;
      // 图、标题、图外细节不变，只换并入文字的归属。
      expect(pages.map(p => [p.body, p.headline, p.imageTitle])).toEqual(legacy.map(p => [p.body, p.headline, p.imageTitle]));
      const total = (ps: { supplement: string }[]) => ps.reduce((n, p) => n + p.supplement.replace(/\s+/g, "").length, 0);
      expect(total(pages)).toBe(total(legacy));
    }
  }, 60_000);

  it("按原书顺序：把各页并入文字依页序拼起来，就是原书文字模块的原顺序", () => {
    for (const markdown of [big.concise, skewed.concise]) {
      const pages = knowledgeEditionIllustratedPages(markdown)!;
      const texts = knowledgeEditionParts(markdown)!.modules.filter(m => m.medium === "text" && m.body.trim()).map(m => m.headline);
      const seen = pages.flatMap(p => Array.from(p.supplement.matchAll(/^### (.+)$/gm), x => x[1]!)).filter(h => texts.includes(h));
      expect(seen).toEqual(texts);
    }
  }, 60_000);
});

describe("attachKnowledgeTextModulesInBookOrder", () => {
  const t = (headline: string, n: number, anchor: number) => ({ headline, body: "字".repeat(n), anchor });
  it("自然归属：每个模块归它前面最近的图，开头归第一张", () => {
    expect(attachKnowledgeTextModulesInBookOrder([1000, 1000, 1000], [t("a", 10, 0), t("b", 10, 2), t("c", 10, 2)]))
      .toEqual(["### a\n\n" + "字".repeat(10), "", "### b\n\n" + "字".repeat(10) + "\n\n### c\n\n" + "字".repeat(10)]);
  });
  it("超容量时均衡到相邻图页、保持顺序、不丢块", () => {
    const texts = Array.from({ length: 40 }, (_, i) => t(`m${i}`, 95, 1));
    const out = attachKnowledgeTextModulesInBookOrder([2000, 2000, 2000, 2000], texts);
    for (const page of out) expect(page.length).toBeLessThanOrEqual(2000);
    expect(out.join("\n\n").match(/### m\d+/g)).toEqual(texts.map(x => `### ${x.headline}`));
  });
  it("单个模块超过页容量：按段落切块续排，不删字", () => {
    const body = Array.from({ length: 30 }, (_, i) => `段${i}` + "字".repeat(200)).join("\n\n");
    const out = attachKnowledgeTextModulesInBookOrder([2500, 2500, 2500, 2500], [{ headline: "长", body, anchor: 0 }]);
    for (const page of out) expect(page.length).toBeLessThanOrEqual(2500);
    expect(out.join("").replace(/### 长(（续\d+）)?|\s/g, "")).toBe(body.replace(/\s/g, ""));
  });
  it("总量超过全部页容量：出图前抛错", () => {
    expect(() => attachKnowledgeTextModulesInBookOrder([100, 100], [t("a", 500, 0)])).toThrow(/未扣费/);
  });
});
