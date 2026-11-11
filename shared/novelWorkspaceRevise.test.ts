import { describe, expect, it } from "vitest";
import {
  novelTestInputSchema,
  novelReviseResultSchema,
  validateNovelReview,
  validateNovelRevision,
  validateNovelStageOutput,
  novelTextLength,
  locateNovelQuote,
  novelRevisePreference,
  novelRevisedChapterSchema,
} from "./novelWorkspace";
import { novelWorkspaceStateSchema } from "./novelWorkspaceState";
import {
  NOVEL_CRAFT_REVIEW_RULES,
  NOVEL_REVIEW_DIMENSIONS,
  NOVEL_REVISION_DISCIPLINE,
} from "./novelCraftReview";
import { REVISE_ORIGINAL, REVISE_REVIEW, REVISE_REVISED } from "./novelRevise.fixture";

const base = {
  requestId: "11111111-1111-4111-8111-111111111111",
  roundId: "22222222-2222-4222-8222-222222222222",
  topic: "权谋",
  direction: "替父翻案",
  templates: [],
  episodeCount: 1,
  chapterIndex: 3,
};

describe("审稿改稿契约", () => {
  it("revise 阶段不需要模板，但必须带待审正文", () => {
    const ok = novelTestInputSchema.parse({ ...base, stage: "revise", reviseDraft: REVISE_ORIGINAL, modelPreference: "carbon" });
    expect(ok.stage).toBe("revise");
    expect(ok.reviseDraft).toBe(REVISE_ORIGINAL);
    expect(() => novelTestInputSchema.parse({ ...base, stage: "revise" })).toThrow();
    expect(() => novelTestInputSchema.parse({ ...base, stage: "revise", reviseDraft: "太短" })).toThrow();
  });
  it("其他阶段不得携带待审正文，原有规则不变", () => {
    expect(() =>
      novelTestInputSchema.parse({ ...base, stage: "advice", reviseDraft: REVISE_ORIGINAL })
    ).toThrow();
    expect(() => novelTestInputSchema.parse({ ...base, stage: "chapter", outline: "大纲" })).toThrow(/请选择模板/);
  });
  it("审稿：七个维度齐全、3–10 条、片段须能在原文定位", () => {
    expect(validateNovelReview(REVISE_ORIGINAL, REVISE_REVIEW).issues).toHaveLength(3);
    expect(() =>
      validateNovelReview(REVISE_ORIGINAL, { ...REVISE_REVIEW, issues: REVISE_REVIEW.issues.slice(0, 2) })
    ).toThrow();
    expect(() =>
      validateNovelReview(REVISE_ORIGINAL, {
        ...REVISE_REVIEW,
        issues: [...REVISE_REVIEW.issues.slice(1), { ...REVISE_REVIEW.issues[0], quote: "原文没有的句子" }],
      })
    ).toThrow(/找不到/);
    const { 伏笔: _, ...missing } = REVISE_REVIEW.scores;
    expect(() => validateNovelReview(REVISE_ORIGINAL, { ...REVISE_REVIEW, scores: missing })).toThrow();
    expect(() =>
      validateNovelReview(REVISE_ORIGINAL, { ...REVISE_REVIEW, scores: { ...REVISE_REVIEW.scores, 逻辑: 6 } })
    ).toThrow();
  });
  it("改稿：字数须在 1200–3000 之间", () => {
    expect(novelTextLength(REVISE_REVISED.text)).toBeGreaterThan(1200);
    expect(validateNovelRevision(REVISE_REVISED).title).toBe("账册");
    expect(() => validateNovelRevision({ ...REVISE_REVISED, text: "太短".repeat(100) })).toThrow(/字数/);
    expect(() => validateNovelRevision({ ...REVISE_REVISED, changes: [] })).toThrow();
  });
  it("阶段结果同时带 original / review / revised", () => {
    const input = novelTestInputSchema.parse({ ...base, stage: "revise", reviseDraft: REVISE_ORIGINAL });
    const value = { chapterIndex: 3, original: REVISE_ORIGINAL, review: REVISE_REVIEW, revised: REVISE_REVISED };
    expect(validateNovelStageOutput(input, value, [])).toEqual(novelReviseResultSchema.parse(value));
  });
  it("旧草稿（没有审稿改稿字段、旧阶段 runs）仍可解析；新字段与新阶段可随草稿保存", () => {
    const old = {
      roundId: base.roundId, topic: "t", direction: "d", mode: "original", source: null,
      templates: [], episodeCount: 3, outline: "", outlineApproved: "", chapters: ["旧稿"],
      novelApproved: "", runs: [],
      chapterVersions: [{ index: 0, text: "旧", savedAt: "2026-01-01" }],
    };
    expect(novelWorkspaceStateSchema.parse(old).chapterRevisions).toBeUndefined();
    const input = novelTestInputSchema.parse({ ...base, stage: "revise", reviseDraft: REVISE_ORIGINAL });
    const next = novelWorkspaceStateSchema.parse({
      ...old,
      runs: [{ input, result: { requestId: base.requestId, stage: "revise", text: "{}", templateIds: [], inputSha256: "a", resultSha256: "b" } }],
      chapterRevisions: [{ index: 2, requestId: base.requestId, savedAt: "x", outcome: "{}" }],
    });
    expect(next.chapterRevisions).toHaveLength(1);
  });
  it("准绳精简、含七个维度与前三集分工，不出现仓库名与模型名", () => {
    expect(NOVEL_CRAFT_REVIEW_RULES.length).toBeLessThanOrEqual(3500);
    for (const d of NOVEL_REVIEW_DIMENSIONS) expect(NOVEL_CRAFT_REVIEW_RULES).toContain(d);
    expect(NOVEL_CRAFT_REVIEW_RULES).toMatch(/300 字内引爆核心冲突/);
    expect(NOVEL_CRAFT_REVIEW_RULES).toMatch(/500 字内亮出金手指/);
    expect(NOVEL_CRAFT_REVIEW_RULES).toMatch(/只对第 1–3 集适用/);
    const all = NOVEL_CRAFT_REVIEW_RULES + NOVEL_REVISION_DISCIPLINE;
    expect(all).not.toMatch(/github|oh-story|human-novel|howells|author-toolkit|claude|gpt|gemini|glm|deepseek|carbon|MIT/i);
  });
  it("引用定位：空白、全半角标点、中英文引号归一化后能定位，quote 修正为原文原始片段", () => {
    const original = "侍郎冷笑：「明日早朝前，\n交不出真账，沈家满门流放！」" + REVISE_ORIGINAL;
    const hit = locateNovelQuote(original, "“明日早朝前,交不出真账");
    expect(hit?.text).toBe("「明日早朝前，\n交不出真账");
    const review = validateNovelReview(original, {
      ...REVISE_REVIEW,
      issues: [{ ...REVISE_REVIEW.issues[0], quote: "明日早朝前, 交不出真账" }, ...REVISE_REVIEW.issues],
    });
    expect(review.issues[0].quote).toBe("明日早朝前，\n交不出真账");
    expect(review.issues[0].located).toBeUndefined();
  });
  it("仍定位不到的意见标 located:false 排在后面；能定位的少于 3 条才判失败", () => {
    const review = validateNovelReview(REVISE_ORIGINAL, {
      ...REVISE_REVIEW,
      issues: [{ ...REVISE_REVIEW.issues[0], quote: "原文没有的句子" }, ...REVISE_REVIEW.issues],
    });
    expect(review.issues).toHaveLength(4);
    expect(review.issues.slice(0, 3).every(i => i.located === undefined)).toBe(true);
    expect(review.issues[3]).toMatchObject({ quote: "原文没有的句子", located: false });
    expect(() =>
      validateNovelReview(REVISE_ORIGINAL, {
        ...REVISE_REVIEW,
        issues: [...REVISE_REVIEW.issues.slice(0, 2), { ...REVISE_REVIEW.issues[2], quote: "不存在甲" }, { ...REVISE_REVIEW.issues[2], quote: "不存在乙" }],
      })
    ).toThrow(/仅2条/);
    // 标准不降：超过 30 字的引用仍不合格
    expect(() =>
      validateNovelReview(REVISE_ORIGINAL, {
        ...REVISE_REVIEW,
        issues: [...REVISE_REVIEW.issues, { ...REVISE_REVIEW.issues[0], quote: "她".repeat(31) }],
      })
    ).toThrow();
  });
  it("outlineImpact：新字段可解析、超长截断、自相矛盾从严；旧结果没有该字段仍可解析", () => {
    const v = validateNovelRevision({
      ...REVISE_REVISED,
      outlineImpact: {
        changed: false,
        level: "none",
        items: [{ what: "钥匙来源改了", before: "从御史台取钥匙", after: "改为翻墙撬锁".repeat(10) }],
      },
    });
    expect(v.outlineImpact).toMatchObject({ changed: true, level: "partial" });
    expect(Array.from(v.outlineImpact!.items[0].after)).toHaveLength(40);
    expect(validateNovelRevision(REVISE_REVISED).outlineImpact).toBeUndefined();
    expect(novelRevisedChapterSchema.parse({ ...REVISE_REVISED, outlineImpact: { changed: true, level: "major", items: [] } }).outlineImpact?.level).toBe("major");
    const old = { chapterIndex: 3, original: REVISE_ORIGINAL, review: REVISE_REVIEW, revised: REVISE_REVISED };
    expect(novelReviseResultSchema.parse(old).models).toBeUndefined();
    expect(novelReviseResultSchema.parse({ ...old, models: { review: "a", revise: "b" } }).models?.revise).toBe("b");
  });
  it("审稿/改稿线路各自生效；旧请求只带 modelPreference 时两步都沿用；其他阶段不得携带", () => {
    const both = novelTestInputSchema.parse({
      ...base, stage: "revise", reviseDraft: REVISE_ORIGINAL,
      modelPreference: "glm", reviewModelPreference: "carbon", rewriteModelPreference: "deepseek",
    });
    expect(novelRevisePreference(both, "review")).toBe("carbon");
    expect(novelRevisePreference(both, "revise")).toBe("deepseek");
    const legacy = novelTestInputSchema.parse({ ...base, stage: "revise", reviseDraft: REVISE_ORIGINAL, modelPreference: "glm" });
    expect(novelRevisePreference(legacy, "review")).toBe("glm");
    expect(novelRevisePreference(legacy, "revise")).toBe("glm");
    expect(() =>
      novelTestInputSchema.parse({ ...base, stage: "outline", templates: [{ publicId: "a", role: "b" }], reviewModelPreference: "glm" })
    ).toThrow(/仅审稿改稿/);
  });
  it("草稿：旧 reviseModelPreference 作审稿线路读取，新增改稿线路与大纲条目快照可保存", () => {
    const old = {
      roundId: base.roundId, topic: "t", direction: "d", mode: "original", source: null,
      templates: [], episodeCount: 3, outline: "", outlineApproved: "", chapters: [],
      novelApproved: "", runs: [], reviseModelPreference: "carbon",
    };
    const parsed = novelWorkspaceStateSchema.parse(old);
    expect(parsed.reviseModelPreference).toBe("carbon");
    expect(parsed.rewriteModelPreference).toBeUndefined();
    const next = novelWorkspaceStateSchema.parse({
      ...old, rewriteModelPreference: "deepseek",
      chapterRevisions: [{ index: 0, requestId: "r", savedAt: "x", outcome: "{}", outlineItem: "第1集：开场" }],
    });
    expect(next.rewriteModelPreference).toBe("deepseek");
    expect(next.chapterRevisions?.[0].outlineItem).toBe("第1集：开场");
  });
});
