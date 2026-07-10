import { describe, expect, it } from "vitest";
import {
  buildBlueOceanLexicon,
  deriveTagCandidatesFromTrendSamples,
  normalizeBlueOceanEntries,
} from "../../shared/blueOceanLexicon";

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
