import { describe, expect, it } from "vitest";
import {
  novelTestInputSchema,
  novelReviseResultSchema,
  validateNovelReview,
  validateNovelRevision,
  validateNovelStageOutput,
  novelTextLength,
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
});
