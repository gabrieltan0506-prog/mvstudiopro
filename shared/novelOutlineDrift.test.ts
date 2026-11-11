import { describe, expect, it } from "vitest";
import {
  detectOutlineDrift,
  extractEpisodeOutline,
  novelOutlineAlertLevel,
} from "./novelOutlineDrift";

const OUTLINE =
  "核心冲突\n替父翻案\n\n人物关系\n沈昭与侍郎\n\n" +
  "第2集：库房夺账\n剧情：沈昭持「户字玉佩」夜入户部库房，从御史台取得钥匙\n本集兑现：拿到真账册\n片尾钩子：侍郎带兵围库房\n\n" +
  "第3集：殿前对质\n剧情：早朝呈账";
const ORIGINAL =
  "沈昭握着户字玉佩，站在户部库房门前。钥匙是从御史台拿来的。".repeat(4) + "侍郎带兵围了库房。";

describe("大纲偏离兜底核对（代码规则）", () => {
  it("取第 N 集大纲条目，不串到下一集", () => {
    const item = extractEpisodeOutline(OUTLINE, 2);
    expect(item).toMatch(/^第2集：库房夺账/);
    expect(item).toContain("片尾钩子");
    expect(item).not.toContain("殿前对质");
    expect(extractEpisodeOutline(OUTLINE, 3)).toContain("早朝呈账");
    expect(extractEpisodeOutline(OUTLINE, 9)).toBe("");
  });
  it("未修改版出现、修改版消失的大纲专名记为提示项；都保留时不提示", () => {
    const item = extractEpisodeOutline(OUTLINE, 2);
    const kept = "沈昭握着户字玉佩进了户部库房，钥匙来自御史台。侍郎带兵围了库房。".repeat(3);
    expect(detectOutlineDrift(item, ORIGINAL, kept)).toEqual([]);
    const drifted = "沈昭翻墙进了户部库房，撬开了门锁。侍郎带兵围了库房。".repeat(3);
    const terms = detectOutlineDrift(item, ORIGINAL, drifted).map(h => h.term);
    expect(terms).toContain("户字玉佩");
    expect(terms.some(t => t.includes("御史"))).toBe(true);
    expect(terms).not.toContain("库房");
    expect(detectOutlineDrift("", ORIGINAL, drifted)).toEqual([]);
  });
  it("提醒级别：major 或 ≥3 条 → major；partial 或有代码提示 → partial；旧数据未申报 → none", () => {
    const item = { what: "x", before: "a", after: "b" };
    expect(novelOutlineAlertLevel({ changed: true, level: "major", items: [] }, [])).toBe("major");
    expect(novelOutlineAlertLevel({ changed: true, level: "partial", items: [item, item, item] }, [])).toBe("major");
    expect(novelOutlineAlertLevel({ changed: true, level: "partial", items: [item] }, [])).toBe("partial");
    expect(novelOutlineAlertLevel(undefined, [{ term: "玉佩", originalCount: 2 }])).toBe("partial");
    expect(novelOutlineAlertLevel(undefined, [])).toBe("none");
  });
});
