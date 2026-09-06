import { describe, expect, it } from "vitest";
import { nativeReportThemePresentation, selectNativeReportTheme } from "./manhuaNativeReportTheme";

describe("报告自动主题：已有分类优先、稳定轮换、离线插画", () => {
  it.each([
    ["玄幻修仙", "celadon"], ["古装权谋", "amber"], ["都市情感", "rose"],
    ["谍战悬疑", "moon"], ["喜剧市井", "apricot"], ["仙俠宗門", "celadon"],
  ])("分类 %s 自动选择 %s", (tag, id) => {
    expect(selectNativeReportTheme({ metadata: { classification: { narrativeFeatureTagsZh: [tag] } }, episodeIndex: 99 }).id).toBe(id);
  });
  it("分类优先于标题，元数据优先于分片；同一集多次导出稳定", () => {
    const input = { metadata: { nameZh: "霸总甜宠", classification: { narrativeFeatureTagsZh: ["玄幻修仙"] } }, card: { templateTitleZh: "谍战悬疑" }, episodeIndex: 5 };
    expect(selectNativeReportTheme(input).id).toBe("celadon");
    expect(selectNativeReportTheme(input)).toEqual(selectNativeReportTheme(input));
  });
  it("情感背叛与诙谐插曲等泛化标签不压过明确赛道标题", () => {
    expect(selectNativeReportTheme({ metadata: { nameZh: "玄幻修仙", classification: { emotionTagsZh: ["情感背叛", "诙谐插曲"] } } }).id).toBe("celadon");
  });
  it("旧卡无元数据时用原始整形标题；不从角色台词猜赛道", () => {
    expect(selectNativeReportTheme({ card: { templateTitleZh: "古装权谋·朝堂对峙" } }).id).toBe("amber");
    expect(selectNativeReportTheme({ card: { shots: [{ actionZh: "众人谈论修仙" }] }, episodeIndex: 4 }).id).toBe("moon");
  });
  it("空值、错误形状与恶意字符串不进入路径/CSS，未知按集号稳定循环", () => {
    for (const episodeIndex of [1, 2, 3, 4, 5, 6]) {
      expect(selectNativeReportTheme({ metadata: { classification: ["错误形状"], nameZh: "../../secret</style><script>" }, episodeIndex }).id)
        .toBe(["celadon", "amber", "rose", "moon", "apricot", "celadon"][episodeIndex - 1]);
    }
    for (const episodeIndex of [NaN, Infinity, 0, -1, 1.2]) expect(selectNativeReportTheme({ episodeIndex }).id).toBe("celadon");
  });
  it("五套真实PNG内嵌，CSS配色与主题一致，不依赖工作目录或外部图片URL", async () => {
    const presentations = await Promise.all([1, 2, 3, 4, 5].map(episodeIndex => nativeReportThemePresentation({ episodeIndex })));
    expect(new Set(presentations.map(p => p.imageDataUri)).size).toBe(5);
    for (const [index, p] of Array.from(presentations.entries())) {
      const buffer = Buffer.from(p.imageDataUri.split(",")[1]!, "base64");
      expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(buffer.length).toBeGreaterThan(100_000);
      expect(p.css).toContain(`--paper:${selectNativeReportTheme({ episodeIndex: index + 1 }).paper}`);
      expect(p.css).toContain("mask-image:linear-gradient");
      expect(p.css).not.toContain("https://");
    }
  });
});
