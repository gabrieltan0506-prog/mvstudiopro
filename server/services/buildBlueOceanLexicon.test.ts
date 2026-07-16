import { describe, expect, it } from "vitest";
import {
  buildBlueOceanLexicon,
  buildEvidenceBlueOceanFallback,
  coerceBlueOceanRaw,
  deriveTagCandidatesFromTrendSamples,
  normalizeBlueOceanEntries,
} from "../../shared/blueOceanLexicon";

describe("normalize / coerce blue ocean shapes", () => {
  it("accepts 一级/二级 Chinese keys and object wrappers", () => {
    expect(
      normalizeBlueOceanEntries({
        蓝海词: [{ 一级: "暑期亲子游", 二级: ["带娃酒店", "避暑清单"] }],
      }),
    ).toEqual([{ primary: "暑期亲子游", secondary: ["带娃酒店", "避暑清单"] }]);
    expect(coerceBlueOceanRaw("A、B；C")).toEqual(["A", "B", "C"]);
  });

  it("drops placeholder empty-state sentences", () => {
    expect(normalizeBlueOceanEntries(["目前尚未检索到蓝海词", "城市漫步"])).toEqual([
      { primary: "城市漫步", secondary: [] },
    ]);
  });

  it("builds evidence fallback from long hotTopics and industry keys", () => {
    const rows = buildEvidenceBlueOceanFallback({
      trackGrowth: [],
      platformDetails: [
        {
          hotTopics: ["城市漫步指南：周末半日线怎么拍才有完播"],
          blueOceanWords: [],
        },
      ],
      industryKeys: ["生活方式"],
      evidenceTitles: ["OOTD 通勤穿搭一周不重样"],
    });
    expect(rows.some((r) => r.primary.includes("城市漫步"))).toBe(true);
    expect(rows.some((r) => r.primary === "生活方式")).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});

describe("buildBlueOceanLexicon", () => {
  it("merges platformMenu string words and graded global words", () => {
    const lex = buildBlueOceanLexicon({
      platformMenu: [
        { platform: "xiaohongshu", blueOceanWords: ["同城相亲攻略", "油皮抗老"] },
        {
          platform: "douyin",
          blueOceanWords: [{ primary: "脱单攻略", secondary: ["颜值", "才艺"] }],
        },
      ],
      globalBlueOceanWords: [{ primary: "家庭急救", secondary: ["心肺复苏"] }],
      tagCandidates: ["情绪免疫力"],
    });
    expect(lex.flat).toContain("同城相亲攻略");
    expect(lex.flat).toContain("颜值");
    expect(lex.flat).toContain("家庭急救");
    expect(lex.flat).toContain("情绪免疫力");
    expect(lex.grouped.some((g) => g.primary === "脱单攻略")).toBe(true);
  });

  it("normalizeBlueOceanEntries accepts mixed shapes", () => {
    const rows = normalizeBlueOceanEntries(
      ["A", { primary: "B", secondary: ["b1"] }, null],
      "xhs",
    );
    expect(rows).toEqual([
      { platform: "xhs", primary: "A", secondary: [] },
      { platform: "xhs", primary: "B", secondary: ["b1"] },
    ]);
  });

  it("deriveTagCandidatesFromTrendSamples pulls tags and short title parts", () => {
    const tags = deriveTagCandidatesFromTrendSamples([
      { tags: ["蓝海词测试", "长尾"], title: "如何避坑｜对比选购" },
    ]);
    expect(tags).toContain("蓝海词测试");
    expect(tags.some((t) => t.includes("避坑") || t.includes("对比"))).toBe(true);
  });
});
