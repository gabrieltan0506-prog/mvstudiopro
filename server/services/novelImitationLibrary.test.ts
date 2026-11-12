import { describe, expect, it, vi } from "vitest";
// 1112 计费：余额充足、扣费成功（不连库）。
vi.mock("../credits", () => ({ getCredits: async () => ({ totalAvailable: 1e9 }), deductCreditsAmount: async () => ({ success: true, cost: 0 }) }));
vi.mock("./manhuaViralTemplateStore", () => ({
  listMergedApprovedManhuaViralTemplatesGrouped: vi.fn(),
  resolveViralTemplateForExpand: vi.fn(),
}));
vi.mock("./manhuaNovelAdaptationRun", () => ({ callNovelStage: vi.fn() }));
import { createHash } from "node:crypto";
import { NOVEL_REVIEW_DIMENSIONS, type NovelReviewDimension } from "../../shared/novelCraftReview";
import {
  NOVEL_IMITATION_COLLECT_SCORE,
  NOVEL_IMITATION_LIBRARY_PICK_MAX,
  novelImitationSkeletonSchema,
  type NovelImitationSkeleton,
} from "../../shared/novelImitation";
import { NOVEL_IMITATION_UI } from "../../shared/novelImitationPrompt";
import { novelTestInputSchema } from "../../shared/novelWorkspace";
import { novelWorkspaceStateSchema } from "../../shared/novelWorkspaceState";
import {
  NOVEL_IMITATION_LIBRARY_NOTE,
  NOVEL_IMITATION_LIBRARY_OMITTED,
  NOVEL_IMITATION_LIBRARY_PREFIX,
  NovelImitationLibraryMissingError,
  collectNovelImitationLibrary,
  deleteNovelImitationLibraryEntry,
  formatNovelImitationLibraryReference,
  listNovelImitationLibrary,
  loadNovelImitationLibraryEntries,
  type NovelImitationLibraryStore,
} from "./novelImitationLibrary";
import {
  NOVEL_IMITATION_SKELETON_VERSION,
  buildNovelImitationMergePrompt,
  buildNovelImitationShardPrompt,
  normalizeNovelImitationSkeleton,
  resolveNovelImitationSkeleton,
} from "./novelImitationSkeleton";
import { buildNovelTestPrompt, executeNovelTest, runNovelImitationSkeleton } from "./novelWorkspaceTest";
import type { NovelTemplateDigestStore } from "./novelTemplateDigest";

const FORBIDDEN = ["侵权", "抄袭", "洗稿", "触线", "查重", "相似度"];

function libraryStore() {
  const objects = new Map<string, { body: string; generation: number }>();
  let gen = 0;
  const store: NovelImitationLibraryStore = {
    read: async name => {
      const o = objects.get(name);
      return o ? { body: o.body, generation: String(o.generation) } : null;
    },
    write: async (name, body) => {
      objects.set(name, { body, generation: ++gen });
    },
    writeIfGeneration: async (name, body, generation) => {
      const o = objects.get(name);
      if (generation === "0" ? !!o : !o || String(o.generation) !== generation) return false;
      objects.set(name, { body, generation: ++gen });
      return true;
    },
    list: async prefix => Array.from(objects.keys()).filter(n => n.startsWith(prefix)),
  };
  const publicText = () =>
    Array.from(objects.entries())
      .filter(([n]) => n.startsWith(NOVEL_IMITATION_LIBRARY_PREFIX))
      .map(([, o]) => o.body)
      .join("\n");
  return { objects, store, publicText };
}
function skeletonStore() {
  const objects = new Map<string, string>();
  const store: NovelTemplateDigestStore = {
    read: async name => objects.get(name) ?? null,
    writeIfAbsent: async (name, body) => {
      if (!objects.has(name)) objects.set(name, body);
    },
  };
  return { objects, store };
}

const BASE_SENTENCE = "萧玄推开天机阁的大门冷风灌进来他低声说今夜必须把账算清楚";
const baseText = `第1章 夜雨\n${BASE_SENTENCE}。\n${"山门外的石阶被雨水洗得发亮，守夜人提灯走过。".repeat(20)}`;
const dims = (n: number) => Object.fromEntries(NOVEL_REVIEW_DIMENSIONS.map(d => [d, n])) as Record<NovelReviewDimension, number>;
const score = (total: number) => ({ total, dimensions: dims(4), reason: "开篇钩子密集，反转有铺垫" });
const highlight = (feature: string) => ({
  title: `${feature}的写法`,
  position: "第1章",
  feature,
  beats: ["主角当众受压", "对手亮出筹码", "主角抛出隐藏信息反压"],
  reusableAs: "可用于职场或校园题材的开局翻盘",
});
const skeleton = (total?: number, highlights = [highlight("开篇钩子"), highlight("信息差运用")]): NovelImitationSkeleton => ({
  title: "天机阁 · 三段打脸升级结构",
  beats: [
    // 模型若把底稿名称与原句写进描述，收录时也要清掉。
    { index: 1, name: "萧玄受压", function: "钩子", position: "第1章", roles: ["主角"], summary: `${BASE_SENTENCE}，主角当众受压` },
    { index: 2, name: "首次反击", function: "爽点", position: "约10%", roles: ["主角", "对手"], summary: "主角在天机阁借细节扳回一局" },
  ],
  properNouns: ["萧玄", "天机阁"],
  ...(total === undefined ? {} : { score: score(total) }),
  highlights,
});

describe("拆书模板：schema 兼容与版本", () => {
  it("旧骨架（无 score / highlights）照常通过；旧草稿照常读取；缓存版本号已 +1", () => {
    const old = { beats: [{ index: 1, name: "开局", function: "钩子", position: "第1章", roles: ["主角"], summary: "开局受压" }], properNouns: ["甲某"] };
    expect(novelImitationSkeletonSchema.parse(old)).toEqual(old);
    expect(normalizeNovelImitationSkeleton(old)).toEqual(old);
    const state = novelWorkspaceStateSchema.parse({
      roundId: "22222222-2222-4222-8222-222222222222", topic: "", direction: "", mode: "imitation", source: null,
      templates: [], episodeCount: 1, outline: "", outlineApproved: "", chapters: [], novelApproved: "", runs: [],
      imitationSkeleton: { baseSha256: "x", savedAt: "t", skeleton: old },
    });
    expect(state.imitationSkeleton?.skeleton.score).toBeUndefined();
    expect(state.libraryTemplatePicks).toBeUndefined();
    expect(NOVEL_IMITATION_SKELETON_VERSION).toBe("novel-imitation-skeleton-v2");
  });
  it("给了 score / highlights 就必须合 schema；highlights 超过 8 条按不合格处理（不截断）", () => {
    const ok = normalizeNovelImitationSkeleton(skeleton(85));
    expect(ok.score?.total).toBe(85);
    expect(ok.highlights).toHaveLength(2);
    expect(() => normalizeNovelImitationSkeleton({ ...skeleton(85), score: { total: 120, dimensions: dims(4), reason: "x" } })).toThrow();
    expect(() => normalizeNovelImitationSkeleton({ ...skeleton(85), score: { total: 85, dimensions: { 紧凑度: 4 }, reason: "x" } })).toThrow();
    expect(() => normalizeNovelImitationSkeleton(skeleton(85, Array.from({ length: 9 }, (_, i) => highlight(`特色${i}`))))).toThrow();
  });
  it("勾选最多 3 条，且不可重复", () => {
    const base = {
      requestId: "11111111-1111-4111-8111-111111111111", roundId: "22222222-2222-4222-8222-222222222222",
      topic: "账本", direction: "翻身", templates: [{ publicId: "mt_a", role: "主骨架" }], episodeCount: 1, stage: "outline",
    };
    expect(novelTestInputSchema.parse({ ...base, libraryTemplateIds: ["a", "b", "c"] }).libraryTemplateIds).toHaveLength(3);
    expect(NOVEL_IMITATION_LIBRARY_PICK_MAX).toBe(3);
    expect(() => novelTestInputSchema.parse({ ...base, libraryTemplateIds: ["a", "b", "c", "d"] })).toThrow();
    expect(() => novelTestInputSchema.parse({ ...base, libraryTemplateIds: ["a", "a"] })).toThrow();
    expect(novelTestInputSchema.parse(base).libraryTemplateIds).toBeUndefined();
  });
});

const UPLOADER = { userId: 4242, title: "斗天录全本.txt" };

describe("拆书模板：收录规则（公共库）", () => {
  it(`综合分 ≥ ${NOVEL_IMITATION_COLLECT_SCORE} 收录整本 + 每条特色章节；列表对任何人一致且不含溯源字段`, async () => {
    const { store } = libraryStore();
    const out = await collectNovelImitationLibrary({ userId: 7, skeleton: skeleton(80), baseText, baseTitle: UPLOADER.title, store });
    expect(out).toEqual({ scored: true, wholeCollected: true, highlightCount: 2 });
    const items = await listNovelImitationLibrary(store);
    expect(items.map(i => i.kind).sort()).toEqual(["highlight", "highlight", "whole"]);
    expect(items.every(i => i.total === 80)).toBe(true);
    expect(items.find(i => i.kind === "whole")!.title).toBe("某 · 三段打脸升级结构");
    expect(items.filter(i => i.feature).map(i => i.feature).sort()).toEqual(["信息差运用", "开篇钩子"]);
    expect(items.every(i => i.kind === "whole" || i.reusableAs)).toBe(true);
    for (const item of items) expect(Object.keys(item).sort()).toEqual(
      ["collectedAt", "id", "kind", "title", "total", ...(item.kind === "highlight" ? ["feature", "reusableAs"] : [])].sort()
    );
  });
  it("综合分 < 80 不收录整本，特色章节仍收录；没有参考分时同样只收特色章节", async () => {
    const { store } = libraryStore();
    expect(await collectNovelImitationLibrary({ userId: 7, skeleton: skeleton(79), baseText, store })).toEqual({
      scored: true, wholeCollected: false, highlightCount: 2,
    });
    expect((await listNovelImitationLibrary(store)).every(i => i.kind === "highlight")).toBe(true);
    const other = libraryStore();
    expect(await collectNovelImitationLibrary({ userId: 7, skeleton: skeleton(undefined), baseText: "另一部", store: other.store })).toEqual({
      scored: false, wholeCollected: false, highlightCount: 2,
    });
  });
  it("公共条目逐项不含：底稿原文 / 原句、properNouns、原作人物名、上传者信息、底稿文件名", async () => {
    const { store, publicText, objects } = libraryStore();
    await collectNovelImitationLibrary({ userId: UPLOADER.userId, skeleton: { ...skeleton(90), title: "斗天录全本 · 升级流" }, baseText, baseTitle: UPLOADER.title, store });
    const pub = publicText();
    // 原文 / 原句
    expect(pub).not.toContain(BASE_SENTENCE);
    expect(pub).not.toContain("山门外的石阶");
    expect(pub).toContain(NOVEL_IMITATION_LIBRARY_OMITTED);
    // properNouns（含人物名「萧玄」）
    expect(pub).not.toContain("properNouns");
    for (const noun of ["萧玄", "天机阁"]) expect(pub).not.toContain(noun);
    expect(pub).toContain("某受压");
    // 文件名（含去扩展名的书名）
    expect(pub).not.toContain(UPLOADER.title);
    expect(pub).not.toContain("斗天录全本");
    // 列表接口返回的内容里也没有上传者 id 与底稿摘要
    const listed = JSON.stringify(await listNovelImitationLibrary(store));
    expect(listed).not.toContain(String(UPLOADER.userId));
    expect(listed).not.toContain(createHash("sha256").update(baseText).digest("hex"));
    expect(listed).not.toMatch(/userId|baseSha256|source|email|nickname/);
    // 文件名只留在该用户的私有证据目录
    const evidence = Array.from(objects.entries()).filter(([n]) => n.startsWith(`novel-imitation-skeleton/user-${UPLOADER.userId}/evidence/library/`));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]![1].body).toContain(UPLOADER.title);
  });
  it("两个不同用户收录不同底稿互不覆盖", async () => {
    const { store } = libraryStore();
    await Promise.all([
      collectNovelImitationLibrary({ userId: 7, skeleton: skeleton(90), baseText, store }),
      collectNovelImitationLibrary({ userId: 8, skeleton: skeleton(85, [highlight("情绪爆点")]), baseText: `${baseText}另一部`, store }),
    ]);
    const items = await listNovelImitationLibrary(store);
    expect(items.filter(i => i.kind === "whole")).toHaveLength(2);
    expect(items.filter(i => i.kind === "highlight").map(i => i.feature).sort()).toEqual(["信息差运用", "开篇钩子", "情绪爆点"]);
  });
  it("同一底稿不论谁上传只保留一套；分数不更高保留原有，更高则整套覆盖", async () => {
    const { store } = libraryStore();
    let t = 1_000;
    const now = () => t;
    await collectNovelImitationLibrary({ userId: 7, skeleton: skeleton(82), baseText, store, now });
    const first = await listNovelImitationLibrary(store);
    t = 2_000;
    const same = await collectNovelImitationLibrary({ userId: 8, skeleton: skeleton(82, [highlight("情绪爆点")]), baseText, store, now });
    expect(same).toEqual({ scored: true, wholeCollected: true, highlightCount: 2, alreadyCollected: true });
    expect((await listNovelImitationLibrary(store)).map(i => i.id).sort()).toEqual(first.map(i => i.id).sort());
    const lower = await collectNovelImitationLibrary({ userId: 8, skeleton: skeleton(60, [highlight("情绪爆点")]), baseText, store, now });
    expect(lower.alreadyCollected).toBe(true);
    t = 3_000;
    const higher = await collectNovelImitationLibrary({ userId: 8, skeleton: skeleton(95, [highlight("情绪爆点")]), baseText, store, now });
    expect(higher).toEqual({ scored: true, wholeCollected: true, highlightCount: 1 });
    const third = await listNovelImitationLibrary(store);
    expect(third).toHaveLength(2);
    expect(third.filter(i => i.kind === "highlight").map(i => i.feature)).toEqual(["情绪爆点"]);
    expect(third.every(i => i.total === 95 && i.collectedAt === new Date(3_000).toISOString())).toBe(true);
    await expect(loadNovelImitationLibraryEntries([first[0]!.id], store)).rejects.toBeInstanceOf(NovelImitationLibraryMissingError);
  });
  it("同一底稿并发收录：条件写保证只留一套，不交叉混入", async () => {
    const { store } = libraryStore();
    await Promise.all([
      collectNovelImitationLibrary({ userId: 7, skeleton: skeleton(88), baseText, store }),
      collectNovelImitationLibrary({ userId: 8, skeleton: skeleton(90, [highlight("情绪爆点")]), baseText, store }),
    ]);
    const items = await listNovelImitationLibrary(store);
    expect(items.every(i => i.total === 90)).toBe(true);
    expect(items.filter(i => i.kind === "highlight").map(i => i.feature)).toEqual(["情绪爆点"]);
  });
});

describe("拆书模板：删除", () => {
  it("管理员删除后不在列表、不能再勾选；同一底稿更高分重新拆解也不收回", async () => {
    const { store } = libraryStore();
    await collectNovelImitationLibrary({ userId: 7, skeleton: skeleton(85), baseText, store });
    const whole = (await listNovelImitationLibrary(store)).find(i => i.kind === "whole")!;
    expect(await deleteNovelImitationLibraryEntry("hl-" + "0".repeat(40), store)).toEqual({ deleted: false });
    expect(await deleteNovelImitationLibraryEntry("../x", store)).toEqual({ deleted: false });
    expect(await deleteNovelImitationLibraryEntry(whole.id, store)).toEqual({ deleted: true });
    expect((await listNovelImitationLibrary(store)).map(i => i.id)).not.toContain(whole.id);
    await expect(loadNovelImitationLibraryEntries([whole.id], store)).rejects.toBeInstanceOf(NovelImitationLibraryMissingError);
    await collectNovelImitationLibrary({ userId: 8, skeleton: skeleton(99), baseText, store });
    expect((await listNovelImitationLibrary(store)).some(i => i.kind === "whole")).toBe(false);
  });
  it("非管理员调用删除接口被拒（adminProcedure）", async () => {
    const { novelWorkspaceRouter } = await import("../routers/novelWorkspace");
    const caller = novelWorkspaceRouter.createCaller({ user: { id: 9, role: "user" } } as never);
    await expect(caller.deleteImitationLibrary({ id: "hl-" + "0".repeat(40) })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("拆书模板：进入提示词", () => {
  const base = {
    requestId: "11111111-1111-4111-8111-111111111111", roundId: "22222222-2222-4222-8222-222222222222",
    topic: "账本", direction: "小人物翻身", templates: [{ publicId: "mt_a", role: "主骨架", weight: 100 }], episodeCount: 1,
  };
  it("勾选的拆书模板进入大纲与正文提示词，带「只借结构」约束；不带名称与溯源；顾问阶段不注入；调用仍只一次", async () => {
    const { store } = libraryStore();
    await collectNovelImitationLibrary({ userId: 7, skeleton: skeleton(90), baseText, baseTitle: "某书名", store });
    const ids = (await listNovelImitationLibrary(store)).map(i => i.id);
    const entries = await loadNovelImitationLibraryEntries(ids, store);
    const ref = formatNovelImitationLibraryReference(entries);
    expect(ref).toContain("只借结构");
    expect(ref).toContain("不沿用示例作品的人名、设定、桥段、原句");
    expect(ref).toContain("整本结构");
    expect(ref).toContain("特色章节：开篇钩子");
    expect(ref).not.toContain("某书名");
    for (const noun of ["萧玄", "天机阁"]) expect(ref).not.toContain(noun);
    const outline = novelTestInputSchema.parse({ ...base, stage: "outline", libraryTemplateIds: ids });
    const chapter = novelTestInputSchema.parse({ ...base, stage: "chapter", outline: "第1集：开局", libraryTemplateIds: ids });
    expect(buildNovelTestPrompt(outline, "", [], { libraryReference: ref })).toContain(NOVEL_IMITATION_LIBRARY_NOTE);
    expect(buildNovelTestPrompt(chapter, "", [], { libraryReference: ref })).toContain(NOVEL_IMITATION_LIBRARY_NOTE);
    const advice = novelTestInputSchema.parse({ ...base, stage: "advice" });
    expect(buildNovelTestPrompt(advice, "", [], { libraryReference: ref })).not.toContain(NOVEL_IMITATION_LIBRARY_NOTE);
    expect(buildNovelTestPrompt(outline, "", [])).not.toContain(NOVEL_IMITATION_LIBRARY_NOTE);
    const call = vi.fn(async () => ({
      text: JSON.stringify({ premise: "p", characters: "c", episodes: [{ index: 1, title: "t", events: "e", hook: "h", payoff: "p" }] }),
      model: "mock",
    }));
    await executeNovelTest(outline, "", [], call, async () => {}, undefined, undefined, ref);
    expect(call).toHaveBeenCalledTimes(1);
    expect((call.mock.calls[0] as unknown as [string])[0]).toContain(NOVEL_IMITATION_LIBRARY_NOTE);
  });
});

describe("拆书模板：评分不增加调用次数", () => {
  const chapterText = (n: number) => `第${n}章 标题${n}\n${"他走进院子。".repeat(1500)}\n`;
  const reply = (prompt: string, rid: string) => {
    if (rid.endsWith("merge"))
      return JSON.stringify({ ...skeleton(88), properNouns: ["萧玄"] });
    const withScore = prompt.includes('"score"');
    return JSON.stringify({ ...skeleton(withScore ? 82 : undefined), properNouns: ["萧玄"] });
  };
  it("多片：调用次数 = 片数 + 1；分片只报候选特色段、汇总给参考分；只有一片时那一片给参考分", async () => {
    const book = Array.from({ length: 6 }, (_, i) => chapterText(i + 1)).join("");
    const call = vi.fn(async (prompt: string, _json: boolean, rid: string) => ({ text: reply(prompt, rid), model: "mock" }));
    const { store } = skeletonStore();
    const out = await resolveNovelImitationSkeleton({ userId: 7, baseText: book, requestId: "r", modelPreference: "glm", call, store, shardChars: 20000 });
    const shards = call.mock.calls.filter(c => !c[2].endsWith("merge"));
    expect(shards.length).toBeGreaterThan(1);
    expect(call).toHaveBeenCalledTimes(shards.length + 1);
    for (const c of shards) {
      expect(c[0]).toContain('"highlights"');
      expect(c[0]).not.toContain('"score"');
    }
    expect(out.score?.total).toBe(88);
    expect(out.highlights).toHaveLength(2);

    const single = vi.fn(async (prompt: string, _json: boolean, rid: string) => ({ text: reply(prompt, rid), model: "mock" }));
    const one = await resolveNovelImitationSkeleton({ userId: 7, baseText: chapterText(1), requestId: "r1", modelPreference: "glm", call: single, store: skeletonStore().store });
    expect(single).toHaveBeenCalledTimes(1);
    expect(single.mock.calls[0]![0]).toContain('"score"');
    expect(one.score?.total).toBe(82);
  });
  it("拆解 + 收录：返回收录结果；收录写不进去时骨架照常返回、标记未完成", async () => {
    const resolve = vi.fn(async () => skeleton(90));
    const { store } = libraryStore();
    const ok = await runNovelImitationSkeleton(
      7,
      { requestId: "r", baseText, baseTitle: "示例底稿" },
      { resolve, collect: p => collectNovelImitationLibrary({ ...p, store }) }
    );
    expect(ok.library).toEqual({ scored: true, wholeCollected: true, highlightCount: 2 });
    expect(ok.skeleton.beats).toHaveLength(2);
    const failed = await runNovelImitationSkeleton(7, { requestId: "r", baseText }, {
      resolve,
      collect: async () => {
        throw new Error("store down");
      },
    });
    expect(failed.library).toEqual({ scored: true, wholeCollected: false, highlightCount: 0, failed: true });
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});

describe("拆书模板：文案", () => {
  it("提示词、注入块与前台文案不含禁用词，不出现模型名", () => {
    const ui = JSON.stringify(
      Object.entries(NOVEL_IMITATION_UI).map(([k, v]) =>
        typeof v !== "function" ? v : k === "originalityNames" ? (v as (t: string[]) => string)(["甲"]) : (v as (...a: unknown[]) => string)(80, 3)
      )
    );
    const texts = [
      ui,
      NOVEL_IMITATION_LIBRARY_NOTE,
      buildNovelImitationShardPrompt("正文", 0, 1),
      buildNovelImitationShardPrompt("正文", 0, 3),
      buildNovelImitationMergePrompt([skeleton(80)]),
    ].join("\n");
    for (const word of FORBIDDEN) expect(texts).not.toContain(word);
    expect(ui).not.toMatch(/gemini|glm|deepseek|carbon|gpt|claude/i);
  });
  it("源码新增部分（服务、面板）不含禁用词", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of [
      "server/services/novelImitationLibrary.ts",
      "client/src/components/canvas/NovelImitationPanels.tsx",
      "shared/novelImitation.ts",
    ]) {
      const src = readFileSync(file, "utf8");
      for (const word of FORBIDDEN) expect(src, `${file}:${word}`).not.toContain(word);
    }
    expect(createHash("sha256").update(baseText).digest("hex")).toHaveLength(64);
  });
});
