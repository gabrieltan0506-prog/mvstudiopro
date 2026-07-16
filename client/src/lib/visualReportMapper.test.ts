import { describe, expect, it } from "vitest";
import {
  fallbackBlueOceanWords,
  mapGenerateVisualReportResult,
  normalizeBlueOceanWords,
} from "./visualReportMapper";

describe("normalizeBlueOceanWords", () => {
  it("accepts structured primary/secondary", () => {
    expect(
      normalizeBlueOceanWords([{ primary: "亲子旅行清单", secondary: ["带娃神器", "行李箱"] }]),
    ).toEqual([{ primary: "亲子旅行清单", secondary: ["带娃神器", "行李箱"] }]);
  });

  it("accepts flat string[] so PNG 蓝海栏不会整段消失", () => {
    expect(normalizeBlueOceanWords(["视觉方法笔记", "可收藏清单"])).toEqual([
      { primary: "视觉方法笔记", secondary: [] },
      { primary: "可收藏清单", secondary: [] },
    ]);
  });
});

describe("mapGenerateVisualReportResult", () => {
  it("falls back to trackGrowth names when globalBlueOceanWords missing", () => {
    const mapped = mapGenerateVisualReportResult(
      {
        report: {
          reportTitle: "测试趋势",
          insightSummary: [],
          trackGrowth: [{ name: "居家收纳", growth: "+12%", isHot: true }],
          platformDetails: [{ platform: "xiaohongshu", hotTopics: ["安静收纳"] }],
        },
      },
      { windowDays: "7", theme: "dark" },
    );
    expect(mapped?.globalBlueOceanWords?.some((b) => b.primary === "居家收纳")).toBe(true);
  });
});

describe("fallbackBlueOceanWords", () => {
  it("aggregates platform blue ocean first", () => {
    const words = fallbackBlueOceanWords({
      trackGrowth: [{ name: "赛道甲" }],
      platformDetails: [
        { blueOceanWords: [{ primary: "蓝海乙", secondary: ["子词"] }], hotTopics: ["热词丙"] },
      ],
    });
    expect(words[0]?.primary).toBe("蓝海乙");
  });

  it("falls back from long hotTopics (>18) via short label", () => {
    const words = fallbackBlueOceanWords({
      trackGrowth: [],
      platformDetails: [
        {
          hotTopics: ["极简生活收纳：租房也能空出一间书房的方法合集"],
          blueOceanWords: [],
        },
      ],
    });
    expect(words.length).toBeGreaterThan(0);
    expect(words[0]?.primary.length).toBeGreaterThanOrEqual(2);
  });
});
