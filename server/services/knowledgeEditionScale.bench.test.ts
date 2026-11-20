import { expect, it } from "vitest";
import { prepareKnowledgeCardEditions, knowledgeEditionSelectionDigest } from "./knowledgeCardEditionPreparation";
import { compactTargetSections } from "./knowledgeCardLevelDerive";
import { compileKnowledgeEditions, knowledgeEditionParts, knowledgeModulesFromMarkdown } from "../../shared/knowledgeCardEdition";
import { knowledgeEditionIllustratedPages, knowledgeEditionImagePlan, knowledgeEditionImageChars, planKnowledgeCardPages } from "../../shared/knowledgeCardPagination";
import { knowledgeEditionBudgetCheck, knowledgeReadingCharBudgets, KNOWLEDGE_READING_CONTRACT, KNOWLEDGE_READING_BUDGET_VERSION } from "../../shared/knowledgeEditionBudget";
import { knowledgeHandbookPagePlan } from "../../shared/knowledgeHandbookPagePlan";
import { knowledgeLayoutSourceOversize, synchronizedKnowledgeCardSource } from "../../shared/knowledgeCardEditableLayout";
import { layoutFromSource, layoutLibrarySchema } from "../../shared/editableLayout";
import { knowledgeReviewBatches, knowledgeSourceSchema, KNOWLEDGE_SUPPLEMENT_MAX_CHARS } from "../../shared/knowledgePublication";
import { knowledgeCardInputFingerprint, knowledgeCardInputKey } from "../../shared/knowledgeCardSourceIdentity";

// 前半程规模探针：替身模型（零成本）+ 正式解析，按 20 节 / 3000 节两种规模跑两档准备与出图前准备，记录耗时与离各硬上限的距离。
const para = (i: number, k: number) => `第${i}节第${k}段：司马光记述此事时，先叙其始末，再论其得失；诸侯之间的盟约、兵力与粮道皆有详载（卷${i % 97}），读者可据此判断形势的转折与因果，并对照前后各卷的人物与制度沿革${k}。`;
const sourceMarkdown = (n: number) => knowledgeModulesFromMarkdown("# 资治通鉴\n\n" + Array.from({ length: n }, (_, i) => `## 卷${Math.floor(i / 14) + 1}·事件${i + 1}\n\n` +
  Array.from({ length: 3 + (i % 9) }, (_, k) => para(i, k)).join("\n\n")).join("\n\n"));

/** 替身：选节请求按要求挑本批前 keep 节；主题命题回空（回退机械标题）。记录请求体积。 */
function fakeInvoke(stats: { calls: number; maxRequest: number; maxResponse: number }, strict = false) {
  return async (request: any) => {
    stats.calls++;
    stats.maxRequest = Math.max(stats.maxRequest, JSON.stringify(request).length);
    const system = request.systemInstruction.parts.map((p: any) => p.text).join("");
    const keep = Number(system.match(/对读者最有用的(\d+)节/)?.[1] || 0);
    let blocks: any[] = [];
    if (keep) {
      const user = JSON.parse(request.contents[0].parts[0].text).source.pages[0].body as string;
      blocks = Array.from(user.matchAll(/^##\s+(.+)$/gm), m => m[1]!).slice(0, strict ? Math.max(1, keep - 1) : keep).map(title => ({ type: "prose", title, note: "", text: "理由" }));
    }
    const text = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ pages: [{ reading: { blocks } }] }) }] } }] });
    stats.maxResponse = Math.max(stats.maxResponse, text.length);
    return { status: 200, text } as any;
  };
}

// 替身按要求逐批照数保留（选节分配 remainder-v1 后 3000 节也能选出目标节数）。
for (const [n, strict] of [[20, false], [3000, false]] as const) {
  it(`${n} 节：两档准备 → 出图前准备，记录耗时与上限余量`, async () => {
    const { title, modules } = sourceMarkdown(n);
    const md = `# ${title}\n\n` + modules.map(m => `## ${m.headline}\n\n${m.body}`).join("\n\n");
    const stats = { calls: 0, maxRequest: 0, maxResponse: 0 };
    const storage = new Map<string, any>();
    let saves = 0, maxObject = 0, totalBytes = 0;
    const evidence = { prefix: `scale-${n}`, read: async (k: string) => storage.get(k) ?? null, save: async (k: string, v: any) => {
      const bytes = Buffer.byteLength(JSON.stringify(v)); saves++; maxObject = Math.max(maxObject, bytes); totalBytes += bytes; sizes.set(k.replace(/\d+/g, "#"), Math.max(sizes.get(k.replace(/\d+/g, "#")) || 0, bytes)); storage.set(k, v); } };
    const sizes = new Map<string, number>();
    const stepTimes: Record<string, number> = {};
    let lastStep = "开始", lastAt = performance.now();
    const t0 = performance.now();
    const result = await prepareKnowledgeCardEditions({ sourceMarkdown: md, invoke: fakeInvoke(stats, strict) as any, evidence,
      onProgress: p => { const step = p.step || `选节第${p.pass}轮`; if (step !== lastStep) { const now = performance.now(); stepTimes[lastStep] = (stepTimes[lastStep] || 0) + Math.round(now - lastAt); lastStep = step; lastAt = now; } } });
    stepTimes[lastStep] = (stepTimes[lastStep] || 0) + Math.round(performance.now() - lastAt);
    const prepareMs = Math.round(performance.now() - t0);
    expect(result.editionIssues?.filter(i => i.kind === "selection")).toEqual([]);

    const timed: Record<string, number> = {};
    const time = <T,>(label: string, f: () => T) => { const t = performance.now(); const v = f(); timed[label] = Math.round(performance.now() - t); return v; };
    time("knowledgeEditionSelectionDigest", () => knowledgeEditionSelectionDigest(md, compactTargetSections(n)));
    time("compileKnowledgeEditions", () => compileKnowledgeEditions(title, modules.map(m => ({ ...m, priority: "secondary" as const }))));
    const limits: Record<string, string> = {};
    for (const level of ["full", "concise"] as const) {
      const markdown = level === "full" ? result.fullEditionMarkdown : result.markdown;
      const parts = time(`${level}.knowledgeEditionParts(冷)`, () => knowledgeEditionParts(markdown + " "))!;
      const plan = time(`${level}.planKnowledgeCardPages`, () => planKnowledgeCardPages(markdown + "\n"));
      const topics = time(`${level}.knowledgeEditionImagePlan`, () => knowledgeEditionImagePlan(markdown + "\n\n"))!;
      time(`${level}.knowledgeEditionBudgetCheck`, () => knowledgeEditionBudgetCheck(level, plan.pageCount, topics.readingChars, knowledgeEditionImageChars(topics)));
      time(`${level}.knowledgeEditionIllustratedPages`, () => knowledgeEditionIllustratedPages(markdown + "\n\n\n"));
      const fingerprint = await (async () => { const t = performance.now(); const v = await knowledgeCardInputFingerprint(knowledgeCardInputKey({ owner: "7", text: markdown, full: result.fullEditionMarkdown, level, template: null, model: "m" })); timed[`${level}.inputFingerprint`] = Math.round(performance.now() - t); return v; })();
      const source = time(`${level}.synchronizedKnowledgeCardSource`, () => synchronizedKnowledgeCardSource({ owner: "7", sourceId: `s-${level}`, inputFingerprint: fingerprint, fullMarkdown: result.fullEditionMarkdown,
        illustrationMarkdown: markdown, detailLevel: level, imageJobIds: plan.pages.map((_, i) => `kc_${i}`) }));
      expect(time(`${level}.knowledgeLayoutSourceOversize`, () => knowledgeLayoutSourceOversize(source))).toBeNull();
      const doc = time(`${level}.layoutFromSource`, () => layoutFromSource(source));
      const parsed = time(`${level}.knowledgeSourceSchema`, () => knowledgeSourceSchema.parse(doc.publication!.source));
      const libBytes = time(`${level}.librarySchema+序列化`, () => Buffer.byteLength(JSON.stringify({ library: layoutLibrarySchema.parse({ version: 1, owner: "7", documents: [doc] }) })));
      time(`${level}.knowledgeReviewBatches`, () => knowledgeReviewBatches(parsed));
      const budgets = time(`${level}.knowledgeReadingCharBudgets(v2)`, () => knowledgeReadingCharBudgets(level, parsed.pages as any, KNOWLEDGE_READING_CONTRACT, KNOWLEDGE_READING_BUDGET_VERSION));
      time(`${level}.knowledgeHandbookPagePlan(v2)`, () => knowledgeHandbookPagePlan(level, parsed.pages.map(p => ({ id: p.id, body: `${p.body}\n\n${p.supplement || ""}`, hasImage: true })), KNOWLEDGE_READING_BUDGET_VERSION));
      const maxSupp = Math.max(0, ...parsed.pages.map(p => (p.supplement || "").length));
      const maxBody = Math.max(...parsed.pages.map(p => p.body.length));
      limits[level] = `图${plan.pageCount}/${level === "full" ? 48 : 30}；模块${parts.modules.length}；单页supplement最大${maxSupp}/${KNOWLEDGE_SUPPLEMENT_MAX_CHARS}；单页body最大${maxBody}/50000；` +
        `标题最长${Math.max(...parsed.pages.map(p => p.headline.length))}/500；整库${(libBytes / 1048576).toFixed(1)}MB/64MB；文字续页预算${budgets.budget.textPages.max}`;
      expect(maxSupp).toBeLessThanOrEqual(KNOWLEDGE_SUPPLEMENT_MAX_CHARS);
    }
    console.log(JSON.stringify({ n, chars: md.length, prepareMs, stepTimes, model: stats, evidence: { saves, top: Array.from(sizes).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, b]) => `${k.replace(/^scale-#\//, "")} ${(b / 1048576).toFixed(1)}MB`), maxObjectMB: +(maxObject / 1048576).toFixed(2), totalMB: +(totalBytes / 1048576).toFixed(1) }, timed, limits }, null, 1));
  }, 300_000);
}

// 回归（2026-11-21 已修，见 knowledgeCardLevelDerive.allocation.test.ts）：旧分配下每批保留数 = max(2, ceil(目标×本批节数/当前节数)) 逐批向上取整，
// 当前节数只略高于目标时各批保留数之和 ≥ 当前节数，该轮零压缩 → 抛「没有压缩效果」→ 精华选节整体失败、精华版 0 张图。
// 3000 节、目标 120：第 1 轮 66 批各留 2 → 132 节；第 2 轮 4 批留 40+38+41+2=121；第 3 轮 3 批留 42/42、44/44、35/35 → 121，失败。
it("3000 节默认目标 120 节：精华选节成功（原第 3 轮零压缩而失败）", async () => {
  const { title, modules } = sourceMarkdown(3000);
  const md = `# ${title}\n\n` + modules.map(m => `## ${m.headline}\n\n${m.body}`).join("\n\n");
  const storage = new Map<string, any>();
  const result = await prepareKnowledgeCardEditions({ sourceMarkdown: md, invoke: fakeInvoke({ calls: 0, maxRequest: 0, maxResponse: 0 }) as any,
    evidence: { prefix: "repro", read: async (k: string) => storage.get(k) ?? null, save: async (k: string, v: any) => { storage.set(k, v); } } });
  expect(result.editionIssues?.filter(i => i.kind === "selection")).toEqual([]);
  expect(planKnowledgeCardPages(result.markdown).pageCount).toBeGreaterThan(0);
}, 300_000);
