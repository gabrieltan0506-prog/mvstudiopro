import { describe, expect, it } from "vitest";
import { compactTargetSections, deriveKnowledgeCardCompact, KNOWLEDGE_SELECTION_ALLOCATION, legacySelectionKeeps, selectionKeeps } from "./knowledgeCardLevelDerive";
import { prepareKnowledgeCardEditions } from "./knowledgeCardEditionPreparation";
import { knowledgeEditionImagePlan, planKnowledgeCardPages } from "../../shared/knowledgeCardPagination";
import { knowledgeEditionParts, knowledgeModulesFromMarkdown } from "../../shared/knowledgeCardEdition";
import { knowledgeTopicImageCount } from "../../shared/knowledgeTopicImagePlan";

const para = (i: number, k: number) => `第${i}节第${k}段：司马光记述此事时，先叙其始末，再论其得失；诸侯之间的盟约、兵力与粮道皆有详载（卷${i % 97}），读者可据此判断形势的转折与因果，并对照前后各卷的人物与制度沿革${k}。`;
// 经正式解析（knowledgeModulesFromMarkdown）生成原稿。
const book = (n: number) => {
  const parsed = knowledgeModulesFromMarkdown("# 资治通鉴\n\n" + Array.from({ length: n }, (_, i) => `## 卷${Math.floor(i / 14) + 1}·事件${i + 1}\n\n` + Array.from({ length: 3 + (i % 9) }, (_, k) => para(i, k)).join("\n\n")).join("\n\n"));
  return `# ${parsed.title}\n\n` + parsed.modules.map(m => `## ${m.headline}\n\n${m.body}`).join("\n\n");
};
/** 替身模型：照要求保留本批前 keep 节（最忠实的模型行为），记下每次请求。 */
function faithfulChat(calls: string[]) {
  return async (c: any) => {
    calls.push(JSON.stringify({ key: c.selectionKey, keep: c.selectionKeep, system: c.system, user: c.user, channel: c.executionChannel, maxTokens: c.maxTokens }));
    return c.user.split(/^(?=## )/m).filter((s: string) => s.startsWith("## ")).slice(0, c.selectionKeep).join("\n\n");
  };
}
const SIZES = [20, 100, 300, 1000, 3200, 4200];

describe("选节保留数分配", () => {
  it("最大余数分配：总和恰为目标、不超过各批节数；旧分配之和 < 当前节数时逐项等于旧分配", () => {
    expect(selectionKeeps([42, 44, 35], 121, 120, KNOWLEDGE_SELECTION_ALLOCATION).reduce((a, b) => a + b)).toBe(120);
    expect(legacySelectionKeeps([42, 44, 35], 121, 120)).toEqual([42, 44, 35]);
    // 非最后一轮、旧分配之和 122 < 129：照旧；最后一轮超目标：按目标分配。
    expect(selectionKeeps([43, 41, 44, 1], 129, 120, KNOWLEDGE_SELECTION_ALLOCATION)).toEqual(legacySelectionKeeps([43, 41, 44, 1], 129, 120));
    const keeps = selectionKeeps([43, 41, 44, 1], 129, 120, KNOWLEDGE_SELECTION_ALLOCATION, true);
    expect(keeps.reduce((a, b) => a + b)).toBe(120);
    keeps.forEach((k, i) => expect(k).toBeLessThanOrEqual([43, 41, 44, 1][i]!));
    expect(selectionKeeps([48, 47, 46], 3000, 120, KNOWLEDGE_SELECTION_ALLOCATION)).toEqual(legacySelectionKeeps([48, 47, 46], 3000, 120));
    expect(selectionKeeps([42, 44, 35], 121, 120)).toEqual([42, 44, 35]);
    expect(selectionKeeps([43, 41, 44, 1], 129, 120, undefined, true)).toEqual(legacySelectionKeeps([43, 41, 44, 1], 129, 120));
  });

  for (const n of SIZES) it(`${n} 节：新分配选出 ≤ 目标节数且不少于目标（书比目标大时）`, async () => {
    const target = compactTargetSections(n);
    const r = await deriveKnowledgeCardCompact({ fullMarkdown: book(n), chat: faithfulChat([]) as any, allocation: KNOWLEDGE_SELECTION_ALLOCATION });
    expect(r.sections).toBe(Math.min(n, target));
  }, 60_000);

  it("旧分配（缺省）行为不变：≤100 节走得通，300 节起仍抛零压缩（旧任务续跑与之前逐字相同）", async () => {
    await expect(deriveKnowledgeCardCompact({ fullMarkdown: book(100), chat: faithfulChat([]) as any })).resolves.toMatchObject({ sections: 17 });
    await expect(deriveKnowledgeCardCompact({ fullMarkdown: book(300), chat: faithfulChat([]) as any })).rejects.toThrow("没有压缩效果");
  });

  it("旧逻辑走得通的规模（20/100 节）：新旧分配的请求逐字相同；大书在零压缩那一轮之前的各轮请求也逐字相同", async () => {
    for (const n of [20, 100]) {
      const oldCalls: string[] = [], newCalls: string[] = [];
      const a = await deriveKnowledgeCardCompact({ fullMarkdown: book(n), chat: faithfulChat(oldCalls) as any });
      const b = await deriveKnowledgeCardCompact({ fullMarkdown: book(n), chat: faithfulChat(newCalls) as any, allocation: KNOWLEDGE_SELECTION_ALLOCATION });
      expect(newCalls).toEqual(oldCalls);
      expect(b).toEqual(a);
    }
    const oldCalls: string[] = [], newCalls: string[] = [];
    await expect(deriveKnowledgeCardCompact({ fullMarkdown: book(3200), chat: faithfulChat(oldCalls) as any })).rejects.toThrow("没有压缩效果");
    await deriveKnowledgeCardCompact({ fullMarkdown: book(3200), chat: faithfulChat(newCalls) as any, allocation: KNOWLEDGE_SELECTION_ALLOCATION });
    const lastOldPass = JSON.parse(oldCalls.at(-1)!).key.split("-")[0];
    const before = (calls: string[]) => calls.filter(c => JSON.parse(c).key.split("-")[0] !== lastOldPass).sort();
    expect(before(newCalls)).toEqual(before(oldCalls));
  }, 60_000);
});

/** 两档准备的替身路由：选节按要求照数保留；命题回空（回退机械标题）。 */
function fakeInvoke(calls: string[]) {
  return async (request: any) => {
    calls.push(JSON.stringify(request));
    const system = request.systemInstruction.parts.map((p: any) => p.text).join("");
    const keep = Number(system.match(/对读者最有用的(\d+)节/)?.[1] || 0);
    const user = keep ? JSON.parse(request.contents[0].parts[0].text).source.pages[0].body as string : "";
    const blocks = Array.from(user.matchAll(/^##\s+(.+)$/gm), m => m[1]!).slice(0, keep).map(title => ({ type: "prose", title, note: "", text: "理由" }));
    return { status: 200, text: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ pages: [{ reading: { blocks } }] }) }] } }] }) } as any;
  };
}
const memory = (prefix: string, storage = new Map<string, any>()) => ({ storage, evidence: { prefix, read: async (k: string) => storage.get(k) ?? null, save: async (k: string, v: any) => { storage.set(k, structuredClone(v)); } } });

describe("两档准备：各规模两档都选出现有规则给出的图数", () => {
  for (const n of SIZES) it(`${n} 节`, async () => {
    const { storage, evidence } = memory(`e-${n}`);
    const result = await prepareKnowledgeCardEditions({ sourceMarkdown: book(n), invoke: fakeInvoke([]) as any, evidence });
    expect(result.editionIssues?.filter(i => i.kind === "selection")).toEqual([]);
    expect(storage.get(`e-${n}/source.json`).selectionAllocation).toBe(KNOWLEDGE_SELECTION_ALLOCATION);
    for (const [level, markdown, cap] of [["concise", result.markdown, 30], ["full", result.fullEditionMarkdown, 48]] as const) {
      const plan = knowledgeEditionImagePlan(markdown)!;
      // 现有规则：min(档位上限, 图模块数, 按字数) —— 由 knowledgeTopicImageCount 给出。
      const imageModules = knowledgeEditionParts(markdown)!.modules.filter(m => m.medium === "image");
      expect(planKnowledgeCardPages(markdown).pageCount).toBe(knowledgeTopicImageCount(level, imageModules));
      expect(plan.images.length).toBeGreaterThan(0);
      expect(plan.images.length).toBeLessThanOrEqual(cap);
      if (n >= 1000) expect(plan.images.length).toBe(cap);
    }
  }, 120_000);

  it("旧任务（source.json 无分配标记）续跑仍用旧分配：已有选节回执零调用复用、请求逐字不变", async () => {
    const md = book(300);
    // 模拟旧版本代码已开工：source.json 不带标记，旧分配第 1、2 轮的逐批选节回执已落盘。
    const { storage, evidence } = memory("legacy");
    const first: string[] = [];
    storage.set("legacy/source.json", { inputDigest: "x", markdown: md, compositionVersion: "original-sections-json-selection-v4" });
    const r1 = await prepareKnowledgeCardEditions({ sourceMarkdown: md, invoke: fakeInvoke(first) as any, evidence });
    expect(storage.get("legacy/source.json").selectionAllocation).toBeUndefined();
    expect(r1.editionIssues).toContainEqual({ kind: "selection", message: "精华版派生没有压缩效果，已停止" });
    // 续跑（去掉成稿与选节结果，只留逐批回执）：零调用、请求身份不变。
    for (const k of Array.from(storage.keys())) if (!/\/selection-[0-9a-f]+\//.test(k) && k !== "legacy/source.json") storage.delete(k);
    const second: string[] = [];
    await prepareKnowledgeCardEditions({ sourceMarkdown: md, invoke: fakeInvoke(second) as any, evidence });
    expect(second.filter(c => c.includes("对读者最有用的"))).toEqual([]);
  }, 120_000);
});
