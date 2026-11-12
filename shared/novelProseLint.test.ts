import { describe, expect, it } from "vitest";
import { lintNovelProse, NOVEL_PROSE_LINT_RULES, summarizeNovelProseLint } from "./novelProseLint";

describe("小说正文 AI 腔确定性检测", () => {
  it("套话句式逐条命中并给出位置", () => {
    const text = "这不是巧合，而是早已布好的棋局。他终于明白，声音不大，却带着不容置疑的力量。没有犹豫，没有迟疑，他带着一丝冷意开口。";
    const ids = lintNovelProse(text).filter(h => h.severity === "blocking").map(h => h.ruleId);
    expect(ids).toEqual(expect.arrayContaining(["not_but", "fate_cliche", "finally_understood", "voice_contrast", "negation_parade", "a_trace_of"]));
    expect(lintNovelProse(text)[0]!.index).toBe(text.indexOf("不是巧合"));
  });

  it("干净的动作与对白不命中套话句式", () => {
    const text = "沈昀把抄目压进废纸堆，起身行礼。“回库监，小人校对仔细，绝无遗漏。”赵承恩端着茶盏，拇指按在铜尺上。";
    expect(summarizeNovelProseLint(text).blocking).toBe(0);
  });

  it("高频虚词按每千字密度判定是否超标；同一文本结果恒定", () => {
    const dense = "他微微一笑，缓缓起身，仿佛什么都没发生，淡淡地看了一眼。".repeat(3);
    const a = summarizeNovelProseLint(dense);
    expect(a.advisory).toBeGreaterThanOrEqual(12);
    expect(a.advisoryOverLimit).toBe(true);
    expect(summarizeNovelProseLint(dense)).toEqual(a);
    const sparse = `${"沈昀翻开那摞待焚的废稿，逐页清点页数，把封签一张张理齐。".repeat(40)}他微微点头。`;
    expect(summarizeNovelProseLint(sparse).advisoryOverLimit).toBe(false);
  });

  it("规则 id 不重复，正则都带全局标志", () => {
    expect(new Set(NOVEL_PROSE_LINT_RULES.map(r => r.id)).size).toBe(NOVEL_PROSE_LINT_RULES.length);
    expect(NOVEL_PROSE_LINT_RULES.every(r => r.pattern.flags.includes("g"))).toBe(true);
  });
});
