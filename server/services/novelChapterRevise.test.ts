import { describe, expect, it, vi } from "vitest";
import {
  buildNovelReviewPrompt,
  buildNovelRevisePrompt,
  executeNovelRevise,
  NovelReviseError,
} from "./novelChapterRevise";
import { novelTestInputSchema } from "../../shared/novelWorkspace";
import { NOVEL_REVIEW_DIMENSIONS } from "../../shared/novelCraftReview";
import { REVISE_ORIGINAL, REVISE_REVIEW, REVISE_REVISED } from "../../shared/novelRevise.fixture";

const input = novelTestInputSchema.parse({
  requestId: "11111111-1111-4111-8111-111111111111",
  roundId: "22222222-2222-4222-8222-222222222222",
  stage: "revise",
  topic: "权谋",
  direction: "替父翻案",
  templates: [],
  episodeCount: 1,
  chapterIndex: 2,
  outline: "第2集：库房夺账",
  continuity: "沈昭：沈家嫡女",
  novel: "第一集已确认正文",
  reviseDraft: REVISE_ORIGINAL,
  modelPreference: "deepseek",
});
const recorder = () => {
  const log: string[] = [];
  return {
    log,
    saveRaw: vi.fn(async (step: string) => void log.push(`raw:${step}`)),
    saveParsed: vi.fn(async (step: string) => void log.push(`parsed:${step}`)),
  };
};

describe("审稿改稿提示词", () => {
  it("审稿提示含七个维度、准绳、待审正文与前文，不含模板目录", () => {
    const p = buildNovelReviewPrompt(input);
    for (const d of NOVEL_REVIEW_DIMENSIONS) expect(p).toContain(d);
    expect(p).toContain("【审稿准绳】");
    expect(p).toContain("第2集的要求");
    expect(p).toContain("沈昭跪在殿前");
    expect(p).toContain("第一集已确认正文");
    expect(p).toContain("沈家嫡女");
    expect(p).not.toMatch(/availableCatalog|templateRoles|模板创作方法|手法卡/);
    expect(buildNovelReviewPrompt({ ...input, chapterIndex: 7 })).toContain("不适用「前三集分工」");
  });
  it("改稿提示含原稿、审稿意见与改稿纪律", () => {
    const p = buildNovelRevisePrompt(input, REVISE_REVIEW as any);
    expect(p).toContain("【改稿纪律】");
    expect(p).toContain("不加新设定");
    expect(p).toContain("1500–2500");
    expect(p).toContain("沈昭跪在殿前");
    expect(p).toContain("主角如何得知钥匙下落没有交代");
    expect(p).not.toMatch(/availableCatalog|templateRoles/);
  });
});

describe("审稿改稿流程", () => {
  it("成功：两次同线路调用，返回 original/review/revised，证据先原始后解析", async () => {
    const r = recorder();
    const call = vi.fn(async (step: string) => ({
      text: JSON.stringify(step === "review" ? REVISE_REVIEW : REVISE_REVISED),
      model: "m",
    }));
    const out = await executeNovelRevise(input, call, r);
    expect(call.mock.calls.map(c => c[0])).toEqual(["review", "revise"]);
    expect(out.result.original).toBe(REVISE_ORIGINAL);
    expect(out.result.review.verdict).toBe(REVISE_REVIEW.verdict);
    expect(out.result.revised.text).toBe(REVISE_REVISED.text);
    expect(r.log).toEqual(["raw:review", "parsed:review", "raw:revise", "parsed:revise"]);
  });
  it("审稿失败：不改稿，整个阶段失败", async () => {
    const r = recorder();
    const call = vi.fn(async () => ({ text: "不是JSON", model: "m" }));
    const err = await executeNovelRevise(input, call, r).catch(e => e);
    expect(err).toBeInstanceOf(NovelReviseError);
    expect(err.kind).toBe("review");
    expect(call).toHaveBeenCalledTimes(1);
    expect(r.log).toEqual(["raw:review"]);
  });
  it("改稿字数不合格：阶段失败但带回审稿结果，两份原始证据都已保存", async () => {
    const r = recorder();
    const call = vi.fn(async (step: string) => ({
      text: JSON.stringify(step === "review" ? REVISE_REVIEW : { ...REVISE_REVISED, text: "短".repeat(600) }),
      model: "m",
    }));
    const err = await executeNovelRevise(input, call, r).catch(e => e);
    expect(err.kind).toBe("revise");
    expect(err.review.verdict).toBe(REVISE_REVIEW.verdict);
    expect(r.log).toEqual(["raw:review", "parsed:review", "raw:revise", "parsed:revise"]);
  });
  it("结果记录审稿、改稿各自所用的模型标识；未定位的意见不进改稿提示的落实清单", async () => {
    const r = recorder();
    const review = {
      ...REVISE_REVIEW,
      issues: [...REVISE_REVIEW.issues, { ...REVISE_REVIEW.issues[0], quote: "原文没有这句", problem: "无法定位的问题" }],
    };
    const prompts: string[] = [];
    const call = vi.fn(async (step: string, prompt: string) => {
      prompts.push(prompt);
      return {
        text: JSON.stringify(step === "review" ? review : REVISE_REVISED),
        model: step === "review" ? "model-a" : "model-b",
      };
    });
    const out = await executeNovelRevise(input, call, r);
    expect(out.result.models).toEqual({ review: "model-a", revise: "model-b" });
    expect(out.result.review.issues.at(-1)?.located).toBe(false);
    expect(prompts[1]).not.toContain("无法定位的问题");
    expect(prompts[1]).toContain("outlineImpact");
    expect(prompts[1]).toContain("episodeOutline");
    expect(prompts[1]).toContain("第2集：库房夺账");
  });
});
