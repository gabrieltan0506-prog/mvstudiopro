import { describe, expect, it } from "vitest";
import {
  NOVEL_REVIEW_CLUSTER_GAP,
  NOVEL_REVIEW_DIMENSION_NEIGHBORS,
  buildNovelReviewOverride,
  compareNovelReviews,
  defaultNovelReviewSelection,
  novelReviewCompareCredits,
  novelReviewDimensionsMergeable,
  novelReviewLaneSelection,
  novelReviewScoreTable,
  type NovelReviewLaneResult,
} from "./novelReviewCompare";
import {
  locateNovelQuote,
  novelReviewOverrideSchema,
  novelTestInputSchema,
  validateNovelReviewOverride,
  type NovelReview,
} from "./novelWorkspace";

/** 测试假数据：几句互不相同的句子，中间用固定长度的填充隔开，便于控制距离。 */
const pad = (n: number) => "。".repeat(n);
const A = "沈昭跪在殿前攥着密信";
const B = "侍郎把账册摔在她脚边";
const C = "她想起父亲留下的玉佩";
const D = "库房卯时换了新锁";
const E = "钥匙落在御史台手里";
const ORIGINAL = [A, pad(10), B, pad(100), C, pad(100), D, pad(30), E, pad(400)].join("");
const scores = (n: number): NovelReview["scores"] => ({
  紧凑度: n, 逻辑: n, 精彩度: n, 反转: n, 情绪高潮: n, 冲突: n, 伏笔: n,
});
const issue = (dimension: NovelReview["issues"][number]["dimension"], quote: string, tag: string) => ({
  dimension,
  quote,
  problem: `问题${tag}`,
  fix: `改法${tag}`,
});
const lane = (
  l: NovelReviewLaneResult["lane"],
  requestId: string,
  issues: NovelReview["issues"],
  s = scores(3),
  verdict = `结论${l}`
): NovelReviewLaneResult => ({ lane: l, requestId, review: { scores: s, issues, keep: [`亮点${l}`], verdict } });
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";

describe("聚类（确定性纯函数）", () => {
  it("区间重叠且维度相同 → 合并为共同指出", () => {
    const r = compareNovelReviews(ORIGINAL, [
      lane("glm", ID1, [issue("逻辑", A, "1a"), issue("冲突", C, "1b"), issue("伏笔", D, "1c")]),
      lane("deepseek", ID2, [issue("逻辑", "跪在殿前攥着", "2a"), issue("反转", E, "2b"), issue("紧凑度", C, "2c")]),
    ]);
    expect(r.shared).toHaveLength(1);
    expect(r.shared[0].lanes).toEqual(["glm", "deepseek"]);
    expect(r.shared[0].items.map(i => i.key)).toEqual(["glm:0", "deepseek:0"]);
    expect(r.shared[0].quote).toBe(A);
    // C 处维度不同（冲突 vs 紧凑度，不在相邻表）→ 不合并，各归独有
    expect(r.unique.glm.map(i => i.key)).toEqual(["glm:1", "glm:2"]);
    expect(r.unique.deepseek.map(i => i.key)).toEqual(["deepseek:1", "deepseek:2"]);
  });
  it("相距 ≤40 字合并、>40 字不合并（相邻判定按原文字符距离）", () => {
    // A 与 B 相距 10 字；C 与 D 相距 100 字
    const near = compareNovelReviews(ORIGINAL, [
      lane("glm", ID1, [issue("逻辑", A, "x"), issue("冲突", C, "y"), issue("伏笔", E, "z")]),
      lane("deepseek", ID2, [issue("逻辑", B, "x"), issue("冲突", D, "y"), issue("反转", A, "z")]),
    ]);
    expect(near.shared.map(c => c.items.map(i => i.key))).toEqual([["glm:0", "deepseek:0"]]);
    expect(near.shared[0].quote).toBe(A + pad(10) + B);
    // D 与 E 相距 30 字 → 合并（维度相同）
    const thirty = compareNovelReviews(ORIGINAL, [
      lane("glm", ID1, [issue("伏笔", D, "1"), issue("冲突", A, "2"), issue("冲突", C, "3")]),
      lane("deepseek", ID2, [issue("伏笔", E, "1"), issue("反转", B, "2"), issue("反转", C, "3")]),
    ]);
    expect(thirty.shared.map(c => c.items.map(i => i.key))).toEqual([["glm:0", "deepseek:0"]]);
    expect(NOVEL_REVIEW_CLUSTER_GAP).toBe(40);
  });
  it("不同维度：相邻维度表内合并，表外不合并", () => {
    expect(NOVEL_REVIEW_DIMENSION_NEIGHBORS).toEqual([["逻辑", "伏笔"], ["情绪高潮", "精彩度"], ["紧凑度", "精彩度"]]);
    expect(novelReviewDimensionsMergeable("伏笔", "逻辑")).toBe(true);
    expect(novelReviewDimensionsMergeable("精彩度", "情绪高潮")).toBe(true);
    expect(novelReviewDimensionsMergeable("紧凑度", "情绪高潮")).toBe(false);
    expect(novelReviewDimensionsMergeable("反转", "冲突")).toBe(false);
    const r = compareNovelReviews(ORIGINAL, [
      lane("glm", ID1, [issue("逻辑", A, "1"), issue("反转", C, "2"), issue("紧凑度", E, "3")]),
      lane("deepseek", ID2, [issue("伏笔", A, "1"), issue("冲突", C, "2"), issue("情绪高潮", E, "3")]),
    ]);
    expect(r.shared.map(c => c.items.map(i => i.key))).toEqual([["glm:0", "deepseek:0"]]);
    expect(r.unique.glm).toHaveLength(2);
  });
  it("无法定位的意见不参与合并，归入本线路独有区（located:false 或原文找不到）", () => {
    const r = compareNovelReviews(ORIGINAL, [
      lane("glm", ID1, [issue("逻辑", A, "1"), issue("冲突", C, "2"), issue("伏笔", "原文里没有这句话", "3")]),
      lane("deepseek", ID2, [
        issue("冲突", C, "1"),
        issue("伏笔", D, "2"),
        { ...issue("逻辑", "原文里没有这句话", "3"), located: false as const },
      ]),
    ]);
    expect(r.shared.map(c => c.items.map(i => i.key))).toEqual([["glm:1", "deepseek:0"]]);
    expect(r.unique.glm.find(i => i.key === "glm:2")!.range).toBeNull();
    expect(r.unique.deepseek.find(i => i.key === "deepseek:2")!.range).toBeNull();
    // 默认勾选：只勾共同指出的
    expect(defaultNovelReviewSelection(r)).toEqual(["glm:1", "deepseek:0"]);
  });
  it("三条线路指出同一处 → 合并为一条，列出三条线路；输入顺序打乱结果不变", () => {
    const lanes = [
      lane("glm", ID1, [issue("逻辑", A, "1"), issue("冲突", C, "2"), issue("反转", E, "3")]),
      lane("deepseek", ID2, [issue("伏笔", "攥着密信", "1"), issue("冲突", D, "2"), issue("反转", B, "3")]),
      lane("carbon", ID3, [issue("逻辑", B, "1"), issue("精彩度", C, "2"), issue("伏笔", E, "3")]),
    ];
    const r = compareNovelReviews(ORIGINAL, lanes);
    expect(r.shared[0].lanes).toEqual(["glm", "deepseek", "carbon"]);
    expect(r.shared[0].items.map(i => i.key)).toEqual(["glm:0", "deepseek:0", "carbon:0"]);
    expect(compareNovelReviews(ORIGINAL, [lanes[2], lanes[0], lanes[1]])).toEqual(r);
  });
  it("同一线路的两条意见不直接相连", () => {
    const r = compareNovelReviews(ORIGINAL, [
      lane("glm", ID1, [issue("逻辑", A, "1"), issue("逻辑", B, "2"), issue("冲突", C, "3")]),
      lane("deepseek", ID2, [issue("反转", D, "1"), issue("反转", E, "2"), issue("冲突", "跪在殿前", "3")]),
    ]);
    expect(r.shared).toEqual([]);
    expect(r.unique.glm).toHaveLength(3);
  });
});

describe("打分表", () => {
  it("分差 ≥2 标「分歧大」；只有一条线路时不标", () => {
    const rows = novelReviewScoreTable([
      lane("glm", ID1, [], { ...scores(4), 逻辑: 5 }),
      lane("carbon", ID3, [], { ...scores(3), 逻辑: 2 }),
    ]);
    expect(rows.map(r => r.dimension)).toEqual(["紧凑度", "逻辑", "精彩度", "反转", "情绪高潮", "冲突", "伏笔"]);
    expect(rows.find(r => r.dimension === "逻辑")).toMatchObject({ spread: 3, divergent: true, scores: { glm: 5, carbon: 2 } });
    expect(rows.find(r => r.dimension === "紧凑度")).toMatchObject({ spread: 1, divergent: false });
    expect(novelReviewScoreTable([lane("glm", ID1, [], scores(1))]).some(r => r.divergent)).toBe(false);
  });
});

describe("综合意见（按所选意见改稿）", () => {
  const lanes = [
    lane("glm", ID1, [issue("逻辑", A, "1a"), issue("冲突", C, "1b"), issue("伏笔", D, "1c")], { ...scores(4), 逻辑: 2 }),
    lane("deepseek", ID2, [issue("逻辑", B, "2a"), issue("反转", E, "2b"), issue("紧凑度", C, "2c")], { ...scores(3), 冲突: 5 }),
    lane("carbon", ID3, [issue("冲突", "原文里没有", "3a"), issue("冲突", D, "3b"), issue("冲突", E, "3c")], scores(1)),
  ];
  it("合并的一处带上各线路的问题与改法；scores 取被勾选线路逐维最低；verdict 由代码拼；来源记 requestId", () => {
    const built = buildNovelReviewOverride(ORIGINAL, lanes, ["glm:0", "deepseek:0", "glm:1", "deepseek:1"]);
    expect("override" in built).toBe(true);
    if (!("override" in built)) return;
    const o = built.override;
    expect(o.issues).toHaveLength(3);
    expect(o.issues[0]).toEqual({ dimension: "逻辑", quote: A, problem: "线路一：问题1a；线路二：问题2a", fix: "线路一：改法1a；线路二：改法2a" });
    expect(o.scores).toEqual({ ...scores(3), 逻辑: 2, 冲突: 4 });
    expect(o.verdict).toBe("综合多条线路的意见。线路一：结论glm；线路二：结论deepseek");
    expect(o.sources).toEqual([{ requestId: ID1, lane: "glm" }, { requestId: ID2, lane: "deepseek" }]);
    expect(o.keep).toEqual(["亮点glm", "亮点deepseek"]);
    expect(novelReviewOverrideSchema.parse(o)).toBeTruthy();
    expect(validateNovelReviewOverride(ORIGINAL, o).issues).toHaveLength(3);
  });
  it("合并一处里只勾一条线路时只带该线路的描述", () => {
    const built = buildNovelReviewOverride(ORIGINAL, lanes, ["deepseek:0", "glm:1", "glm:2"]);
    if (!("override" in built)) throw new Error("应可组成");
    expect(built.override.issues[0]).toMatchObject({ problem: "问题2a", fix: "改法2a" });
  });
  it("下限 1 条（不硬凑意见）；一条都没勾、勾了未能定位的意见 → 不能组成", () => {
    expect(buildNovelReviewOverride(ORIGINAL, lanes, ["glm:0", "deepseek:0"])).toMatchObject({ issueCount: 1 });
    expect("error" in buildNovelReviewOverride(ORIGINAL, lanes, ["glm:0", "glm:1"])).toBe(false);
    expect("error" in buildNovelReviewOverride(ORIGINAL, lanes, ["glm:0"])).toBe(false);
    expect("error" in buildNovelReviewOverride(ORIGINAL, lanes, [])).toBe(true);
    expect(buildNovelReviewOverride(ORIGINAL, lanes, ["carbon:0", "glm:1", "glm:2", "glm:0"])).toEqual({
      error: "未能定位原文的意见不能用于改稿",
      issueCount: 0,
    });
  });
  it("只用这条线路：等价于只勾该线路全部能定位的意见", () => {
    expect(novelReviewLaneSelection(ORIGINAL, lanes, "carbon")).toEqual(["carbon:1", "carbon:2"]);
    const only = buildNovelReviewOverride(ORIGINAL, lanes, novelReviewLaneSelection(ORIGINAL, lanes, "glm"));
    if (!("override" in only)) throw new Error("应可组成");
    expect(only.override.scores).toEqual(lanes[0].review.scores);
    expect(only.override.verdict).toBe("只用线路一的意见。线路一：结论glm");
    expect(only.override.sources).toEqual([{ requestId: ID1, lane: "glm" }]);
  });
  it("价格沿用站长定的三档：线路一 10、线路二 5、线路三特价 20（12-01 起 40）", () => {
    const before = Date.parse("2026-11-20T00:00:00+08:00");
    const after = Date.parse("2026-12-01T00:00:00+08:00");
    expect(novelReviewCompareCredits(["glm", "deepseek"], before)).toBe(15);
    expect(novelReviewCompareCredits(["glm", "deepseek", "carbon"], before)).toBe(35);
    expect(novelReviewCompareCredits(["glm", "deepseek", "carbon"], after)).toBe(55);
    expect(novelReviewCompareCredits(["glm", "glm"], before)).toBe(10);
  });
});

describe("请求字段校验", () => {
  const base = {
    requestId: ID1,
    roundId: ID2,
    stage: "revise" as const,
    topic: "权谋",
    direction: "替父翻案",
    templates: [],
    episodeCount: 1,
    reviseDraft: ORIGINAL,
  };
  const override = {
    scores: scores(3),
    issues: [issue("逻辑", A, "1"), issue("冲突", C, "2"), issue("伏笔", D, "3")],
    keep: [],
    verdict: "综合多条线路的意见。",
    sources: [{ requestId: ID3, lane: "glm" as const }],
  };
  it("旧请求不带新字段照常通过", () => {
    expect(novelTestInputSchema.parse(base).reviseMode).toBeUndefined();
  });
  it("reviseMode / reviewOverride 只随 revise 携带，二者不能同时出现", () => {
    expect(novelTestInputSchema.safeParse({ ...base, reviseMode: "review_only" }).success).toBe(true);
    expect(novelTestInputSchema.safeParse({ ...base, reviewOverride: override }).success).toBe(true);
    expect(novelTestInputSchema.safeParse({ ...base, reviseMode: "review_only", reviewOverride: override }).success).toBe(false);
    const advice = { ...base, stage: "advice", reviseDraft: undefined };
    expect(novelTestInputSchema.safeParse({ ...advice, reviseMode: "review_only" }).success).toBe(false);
    expect(novelTestInputSchema.safeParse({ ...advice, reviewOverride: override }).success).toBe(false);
  });
  it("综合意见：原文定位不到、located:false、条数不足、来源重复都拒收", () => {
    const bad = (o: object) => novelTestInputSchema.safeParse({ ...base, reviewOverride: o }).success;
    expect(bad({ ...override, issues: [...override.issues.slice(0, 2), issue("反转", "不在原文", "x")] })).toBe(false);
    expect(bad({ ...override, issues: [...override.issues.slice(0, 2), { ...issue("反转", D, "x"), located: false }] })).toBe(false);
    expect(bad({ ...override, issues: override.issues.slice(0, 2) })).toBe(true); // 1112：下限 1 条
    expect(bad({ ...override, issues: [] })).toBe(false);
    expect(bad({ ...override, sources: [override.sources[0], override.sources[0]] })).toBe(false);
    expect(bad({ ...override, sources: [] })).toBe(false);
    expect(() => validateNovelReviewOverride("别的正文".repeat(200), override)).toThrow(/找不到/);
    expect(locateNovelQuote(ORIGINAL, A)).toBeTruthy();
  });
});
