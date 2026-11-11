import { describe, it, expect, vi } from "vitest";
vi.mock("./manhuaViralTemplateStore", () => ({
  listMergedApprovedManhuaViralTemplatesGrouped: vi.fn(),
  resolveViralTemplateForExpand: vi.fn(),
}));
vi.mock("./manhuaNovelAdaptationRun", () => ({ callNovelStage: vi.fn() }));
import { buildNovelTestPrompt, executeNovelTest } from "./novelWorkspaceTest";
import { buildNovelReviewPrompt, buildNovelRevisePrompt } from "./novelChapterRevise";
import { novelTestInputSchema, type NovelReview } from "../../shared/novelWorkspace";
import { NOVEL_CREATIVE_FIRST_RULE } from "../../shared/novelCraftCards";

const MARK = "【本作核心创意】";
const PREMISE = "测试用核心创意：甲乙丙丁（假数据）";
const base = novelTestInputSchema.parse({
  requestId: "11111111-1111-4111-8111-111111111111",
  roundId: "22222222-2222-4222-8222-222222222222",
  stage: "advice",
  topic: "测试作品",
  direction: "测试方向",
  templates: [{ publicId: "mt_a", role: "主线", weight: 100 }],
  selectedTemplateIds: ["mt_a"],
  episodeCount: 3,
  outline: "第1集：测试\n剧情：测试",
  novel: "测".repeat(600),
});
const imitation = {
  genre: "测试新题材",
  synopsis: "测试新纲要",
  skeleton: [{ beat: "开局", function: "钩子", position: 0.1, role: "立人设" }],
} as any;
// 文末模板文字里带通用创意优先规则（与线上 advice / 检索注入一致）。
const templates = `模板手法\n\n${NOVEL_CREATIVE_FIRST_RULE}`;
const catalog = [{ publicId: "mt_b", intro: "简介", tags: ["标签"] }];
const prompt = (input: any) => buildNovelTestPrompt(input, templates, catalog);
const premiseOut = (n = 4) => ({
  assessment: "四个切入点（假数据）",
  recommendations: [],
  premises: Array.from({ length: n }, (_, i) => ({
    title: `设想${i}`,
    whatIf: `如果${i}会怎样`,
    ruleAndCost: `规则${i}`,
    drives: `推动${i}`,
    twist: `打破${i}`,
    logline: `梗概${i}`,
    risk: `难点${i}`,
  })),
});
const review: NovelReview = {
  scores: { 紧凑度: 3, 逻辑: 3, 精彩度: 3, 反转: 3, 情绪高潮: 3, 冲突: 3, 伏笔: 3 },
  issues: [{ dimension: "逻辑", quote: "测", problem: "p", fix: "f" }],
  keep: [],
  verdict: "v",
};

describe("创意环节 · 提示词", () => {
  const premises = { ...base, advisorIntent: "creative_premises" as const };
  it("要求恰好四个设想且核心机制互异、禁止现成套路直接复用、不评分", () => {
    const p = prompt(premises);
    expect(p).toContain("恰好4个高概念核心设想");
    expect(p).toContain("核心机制必须互不相同");
    expect(p).toContain("同一机制换皮");
    expect(p).toContain("重生、系统、穿越、金手指");
    expect(p).toContain("不给评分");
    expect(p).toContain('"premises":[{"title"');
    for (const k of ["whatIf", "ruleAndCost", "drives", "twist", "logline", "risk"]) expect(p).toContain(`"${k}"`);
    // 不挑模板：不送目录
    expect(p).toContain('"availableCatalog":[]');
    expect(p).not.toContain("mt_b");
  });
  it("换一批：已出过的标题与核心设想作为排除方向带上；首批没有这一段", () => {
    const first = prompt(premises);
    expect(first).not.toContain("这一批不要重复");
    const again = prompt({ ...premises, premiseExclusions: [{ title: "旧设想甲", whatIf: "如果旧甲会怎样" }] });
    expect(again).toContain("这一批不要重复");
    expect(again).toContain("旧设想甲");
    expect(again).toContain("如果旧甲会怎样");
  });
  it("三种模式各自的约束", () => {
    const original = prompt(premises);
    expect(original).toContain("原创新方向");
    expect(original).not.toContain("改编切入角度");
    const source = prompt({ ...premises, source: { label: "底本", text: "底本正文" } });
    expect(source).toContain("改编切入角度");
    expect(source).toContain("不推翻底本主线");
    const imit = prompt({ ...premises, imitation });
    expect(imit).toContain("爆款仿写");
    expect(imit).toContain("imitationBrief.synopsis");
    expect(imit).toContain("节拍功能相容");
    expect(imit).not.toContain("改编切入角度");
  });
  it("创意环节本身不注入已采用的核心创意", () => {
    expect(prompt({ ...premises, creativePremise: PREMISE })).not.toContain(MARK);
  });
});

describe("本作核心创意 · 进入后续阶段", () => {
  const stages: any[] = [
    { ...base },
    { ...base, advisorMessage: "继续讨论" },
    { ...base, advisorIntent: "story_variants" },
    { ...base, stage: "outline" },
    { ...base, stage: "outline", imitation },
    { ...base, stage: "chapter", chapterIndex: 1 },
  ];
  it("advice（讨论 / 故事线）、outline、chapter 带上，且位于通用创意优先规则之前", () => {
    for (const input of stages) {
      const p = prompt({ ...input, creativePremise: PREMISE });
      expect(p).toContain(MARK);
      expect(p).toContain(PREMISE);
      expect(p.indexOf(MARK)).toBeLessThan(p.indexOf("【创意优先】"));
    }
    expect(prompt({ ...base, stage: "outline", creativePremise: PREMISE })).toContain("关键转折、核心冲突与结局必须由这条创意引出");
    expect(prompt({ ...base, stage: "chapter", creativePremise: PREMISE })).toContain("只有在这条创意之下才会发生");
  });
  it("剧本阶段不重复注入（由正文转写）", () => {
    expect(prompt({ ...base, stage: "script", episodeCount: 1, creativePremise: PREMISE })).not.toContain(MARK);
  });
  it("审稿：偏离或闲置核心创意要列为问题；改稿：不得改回常规套路", () => {
    const rv: any = { ...base, stage: "revise", templates: [], reviseDraft: "测".repeat(600), creativePremise: PREMISE };
    const r = buildNovelReviewPrompt(rv);
    expect(r).toContain(MARK);
    expect(r).toContain("偏离");
    expect(r).toContain("闲置");
    // 评分口径不变：仍是七个维度、1–5 分
    expect(r).toContain("逐项打 1–5 分");
    const w = buildNovelRevisePrompt(rv, review);
    expect(w).toContain(MARK);
    expect(w).toContain("不得把这条核心创意改回常规套路");
  });
  it("为空（缺省 / 空串 / 空白）时各阶段提示词逐字不变", () => {
    for (const input of [...stages, { ...base, stage: "script", episodeCount: 1 }]) {
      const plain = prompt(input);
      expect(plain).not.toContain(MARK);
      expect(prompt({ ...input, creativePremise: "" })).toBe(plain);
      expect(prompt({ ...input, creativePremise: "   " })).toBe(plain);
    }
    const rv: any = { ...base, stage: "revise", templates: [], reviseDraft: "测".repeat(600) };
    expect(buildNovelReviewPrompt({ ...rv, creativePremise: " " })).toBe(buildNovelReviewPrompt(rv));
    expect(buildNovelRevisePrompt({ ...rv, creativePremise: "" }, review)).toBe(buildNovelRevisePrompt(rv, review));
    expect(buildNovelReviewPrompt(rv)).not.toContain(MARK);
  });
});

describe("创意环节 · 结果解析与校验（照故事线方案：先存原始返回，失败抛错）", () => {
  const input = novelTestInputSchema.parse({ ...base, advisorIntent: "creative_premises" });
  const run = (value: unknown, save = vi.fn(async () => {})) =>
    executeNovelTest(input, "", [], async () => ({ text: typeof value === "string" ? value : JSON.stringify(value), model: "test" }), save);
  it("四个合法设想通过；模型多给的模板推荐被丢弃", async () => {
    const out = await run({ ...premiseOut(), recommendations: [{ publicId: "mt_x", reason: "r", tradeoff: "t" }] });
    expect((out as any).premises).toHaveLength(4);
    expect((out as any).recommendations).toEqual([]);
  });
  it("数量不对、标题或核心设想重复、缺字段、非 JSON 都判失败，且原始返回已先保存", async () => {
    const dupTitle = premiseOut();
    dupTitle.premises[1].title = "设想0";
    const dupWhatIf = premiseOut();
    dupWhatIf.premises[2].whatIf = "如果 0 会怎样。";
    dupWhatIf.premises[0].whatIf = "如果0会怎样";
    const missing = premiseOut() as any;
    delete missing.premises[0].risk;
    for (const bad of [premiseOut(3), premiseOut(5), dupTitle, dupWhatIf, missing, { assessment: "a", recommendations: [] }, "not json"]) {
      const save = vi.fn(async () => {});
      await expect(run(bad, save)).rejects.toThrow();
      expect(save).toHaveBeenCalledTimes(1);
    }
  });
  it("非创意环节的请求返回 premises 判失败", async () => {
    const plain = novelTestInputSchema.parse({ ...base, advisorMessage: "继续" });
    await expect(
      executeNovelTest(plain, "", [], async () => ({ text: JSON.stringify(premiseOut()), model: "test" }), async () => {})
    ).rejects.toThrow("当前请求未要求核心创意");
  });
});
