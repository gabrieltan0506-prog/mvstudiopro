import { describe, it, expect } from "vitest";
import { novelTestInputSchema } from "./novelWorkspace";
import { novelWorkspaceStateSchema } from "./novelWorkspaceState";
import {
  NOVEL_CREATIVE_PREMISE_EXCLUSION_MAX,
  NOVEL_CREATIVE_PREMISE_MAX,
  NOVEL_CREATIVE_PREMISE_UI,
  collectNovelCreativePremiseExclusions,
  formatNovelCreativePremise,
  type NovelCreativePremise,
} from "./novelCreativePremise";

const req = {
  requestId: "11111111-1111-4111-8111-111111111111",
  roundId: "22222222-2222-4222-8222-222222222222",
  stage: "advice",
  topic: "测试作品",
  direction: "测试方向",
  templates: [],
  episodeCount: 3,
};
const p = (i: number, extra = ""): NovelCreativePremise => ({
  title: `设想${i}`,
  whatIf: `如果${i}会怎样${extra}`,
  ruleAndCost: "规则",
  drives: "推动",
  twist: "打破",
  logline: "梗概",
  risk: "难点",
});

describe("请求字段", () => {
  it("没选模板、没取过顾问建议也能请求核心创意", () => {
    expect(novelTestInputSchema.safeParse({ ...req, advisorIntent: "creative_premises" }).success).toBe(true);
  });
  it("只能在顾问环节；排除方向只随创意环节携带；核心创意有上限", () => {
    expect(novelTestInputSchema.safeParse({ ...req, stage: "outline", templates: [{ publicId: "mt_a", role: "r" }], advisorIntent: "creative_premises" }).success).toBe(false);
    expect(novelTestInputSchema.safeParse({ ...req, premiseExclusions: [{ title: "a", whatIf: "b" }] }).success).toBe(false);
    expect(novelTestInputSchema.safeParse({ ...req, advisorIntent: "creative_premises", premiseExclusions: [{ title: "a", whatIf: "b" }] }).success).toBe(true);
    expect(novelTestInputSchema.safeParse({ ...req, creativePremise: "创".repeat(NOVEL_CREATIVE_PREMISE_MAX) }).success).toBe(true);
    expect(novelTestInputSchema.safeParse({ ...req, creativePremise: "创".repeat(NOVEL_CREATIVE_PREMISE_MAX + 1) }).success).toBe(false);
  });
  it("旧请求（无新字段）照常解析", () => {
    expect(novelTestInputSchema.parse({ ...req, advisorIntent: "story_variants", templates: [{ publicId: "mt_a", role: "r" }] }).creativePremise).toBeUndefined();
  });
});

describe("草稿兼容", () => {
  const old = {
    roundId: req.roundId,
    topic: "旧作",
    direction: "旧方向",
    mode: "original",
    templates: [],
    episodeCount: 3,
    outline: "",
    outlineApproved: "",
    chapters: [],
    novelApproved: "",
    runs: [],
  };
  it("旧草稿没有核心创意字段也能读取", () => {
    const v = novelWorkspaceStateSchema.parse(old);
    expect(v.creativePremise).toBeUndefined();
    expect(v.creativePremises).toBeUndefined();
  });
  it("新字段保存后能读回（不被丢弃）", () => {
    const v = novelWorkspaceStateSchema.parse({
      ...old,
      creativePremise: "自己写的核心创意",
      creativePremises: { requestId: "r", savedAt: "2026-11-12T00:00:00Z", premises: [p(1), p(2), p(3), p(4)] },
    });
    expect(v.creativePremise).toBe("自己写的核心创意");
    expect(v.creativePremises?.premises).toHaveLength(4);
  });
});

describe("采用与换一批", () => {
  it("采用时整理成可编辑文本，不含写作难点，不超上限", () => {
    const text = formatNovelCreativePremise(p(1));
    expect(text).toContain("设想1");
    expect(text).toContain("核心设想：如果1会怎样");
    expect(text).not.toContain("难点");
    const long = formatNovelCreativePremise({ ...p(1), drives: "长".repeat(800), ruleAndCost: "长".repeat(600) });
    expect(Array.from(long).length).toBeLessThanOrEqual(NOVEL_CREATIVE_PREMISE_MAX);
  });
  it("排除方向去重并只保留最近若干条", () => {
    const ex = collectNovelCreativePremiseExclusions([[p(1), p(2)], [p(2), p(3)]]);
    expect(ex.map(e => e.title)).toEqual(["设想1", "设想2", "设想3"]);
    const many = collectNovelCreativePremiseExclusions(
      Array.from({ length: 15 }, (_, b) => [0, 1, 2, 3].map(i => p(b * 4 + i)))
    );
    expect(many).toHaveLength(NOVEL_CREATIVE_PREMISE_EXCLUSION_MAX);
    expect(many.at(-1)?.title).toBe("设想59");
  });
});

describe("前台文案", () => {
  const all = JSON.stringify(NOVEL_CREATIVE_PREMISE_UI);
  it("不出现敏感用词与模型 / 通道名", () => {
    for (const w of ["侵权", "抄袭", "洗稿", "触线", "查重", "相似度", "线路", "GLM", "DeepSeek", "Gemini", "Carbon", "模型"])
      expect(all).not.toContain(w);
  });
  it("按钮与说明文案", () => {
    expect(NOVEL_CREATIVE_PREMISE_UI.generate).toBe("先出 4 个核心创意");
    expect(NOVEL_CREATIVE_PREMISE_UI.refresh).toBe("换一批");
    expect(NOVEL_CREATIVE_PREMISE_UI.adopt).toBe("采用这个创意");
    expect(NOVEL_CREATIVE_PREMISE_UI.fieldLabel).toBe("本作核心创意");
    expect(NOVEL_CREATIVE_PREMISE_UI.note).toBe("核心创意会带进之后的顾问讨论、大纲与正文；修改后对已生成内容不自动重写。");
  });
});

describe("无底本创意的模板引用与故事大纲（1112c）", () => {
  const outline = "开端：甲\n发展：乙\n转折：丙\n高潮：丁\n结局：戊";
  it("旧数据（无 templates / outline）与新数据都能解析；模板最多 3 个", async () => {
    const { novelCreativePremiseSchema } = await import("./novelCreativePremise");
    expect(novelCreativePremiseSchema.safeParse(p(1)).success).toBe(true);
    expect(novelCreativePremiseSchema.safeParse({ ...p(1), templates: ["mt_a", "mt_b"], outline }).success).toBe(true);
    expect(novelCreativePremiseSchema.safeParse({ ...p(1), templates: ["a", "b", "c", "d"] }).success).toBe(false);
  });
  it("采用时故事大纲一并整理进本作核心创意；超长时优先保留核心设想、规则与代价、故事大纲", () => {
    const short = formatNovelCreativePremise({ ...p(1), outline });
    expect(short).toContain("故事大纲：\n开端：甲");
    expect(short).toContain("一句话梗概");
    const long = formatNovelCreativePremise({
      ...p(1),
      ruleAndCost: "规".repeat(300),
      drives: "推".repeat(500),
      twist: "破".repeat(300),
      outline: "纲".repeat(500),
    });
    expect(Array.from(long).length).toBeLessThanOrEqual(NOVEL_CREATIVE_PREMISE_MAX);
    expect(long).toContain("核心设想：如果1会怎样");
    expect(long).toContain("规".repeat(300));
    expect(long).toContain("纲".repeat(500));
    expect(long).not.toContain("怎样推动故事");
    // 没有大纲的旧数据：与原来一致
    expect(formatNovelCreativePremise(p(2))).toBe(
      ["设想2", "核心设想：如果2会怎样", "规则与代价：规则", "怎样推动故事：推动", "打破的惯例：打破", "一句话梗概：梗概"].join("\n")
    );
  });
});
