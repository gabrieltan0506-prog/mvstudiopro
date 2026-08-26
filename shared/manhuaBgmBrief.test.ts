/**
 * 编译器口径按 bgm-scoring skill（七条实弹 prompt 蒸馏）验收。
 */
import { describe, expect, it } from "vitest";
import {
  BGM_DURATION_MAX_SEC,
  BGM_DURATION_MIN_SEC,
  BGM_STYLE_MAX_DESCRIPTORS,
  buildBgmStructurePrompt,
  buildManhuaBgmBrief,
  clampBgmDurationSec,
  countBgmStyleDescriptors,
  assertBgmStyleSubmittable,
  looksLikeArtistName,
  resolveBgmDurationSec,
} from "./manhuaBgmBrief";

const base = { laneZh: "悬疑权谋", moods: ["蓄力", "冲突", "收束"] as const, durationSec: 18 };

describe("五要素写法", () => {
  it("情绪弧线写「从哪到哪」，不是「是什么」", () => {
    const b = buildManhuaBgmBrief(base);
    // 没有弧线的 prompt 出来的曲子是一条平的，混进片子只能当底噪
    expect(b.style).toContain("转为");
    expect(b.style.startsWith("压抑积压")).toBe(true);
  });

  it("读片得到的弧线优先于剧本猜的 —— 片后配乐看到的比片前猜的准", () => {
    const b = buildManhuaBgmBrief({ ...base, moodArcZh: "绝望到底，突然夺回胜局" });
    expect(b.style).toContain("绝望到底，突然夺回胜局");
    expect(b.style).not.toContain("压抑积压");
  });

  it("乐器点名带演奏法 —— 只写乐器名模型自由发挥", () => {
    expect(buildManhuaBgmBrief({ ...base, laneZh: "古言种田" }).style).toContain("轮指扫弦");
    expect(buildManhuaBgmBrief(base).style).toContain("由疏到密");
  });

  it("收尾必须写死；不给就用默认，不留空", () => {
    expect(buildManhuaBgmBrief(base).style).toContain("最后两秒淡出");
    expect(buildManhuaBgmBrief({ ...base, endingZh: "瞬间用战鼓收尾" }).style).toContain(
      "瞬间用战鼓收尾",
    );
  });

  it("分段 bpm 比单一 bpm 精确，给了就用它", () => {
    const b = buildManhuaBgmBrief({ ...base, tempoPlanZh: "1-6秒60bpm，7-13秒70bpm" });
    expect(b.style).toContain("60bpm");
  });

  it("硬参数齐：时长 + 采样率", () => {
    const b = buildManhuaBgmBrief(base);
    expect(b.style).toContain("44.1KHz");
    expect(b.style).toContain(`${b.duration}秒`);
  });

  it("描述词不超过 12 个 —— 同义词堆叠会互相稀释", () => {
    const b = buildManhuaBgmBrief(base);
    expect(countBgmStyleDescriptors(b.style)).toBeLessThanOrEqual(BGM_STYLE_MAX_DESCRIPTORS);
  });
});

describe("结构标签（多数人漏掉的一层）", () => {
  it("instrumental 下 prompt 放结构标签，不是留空", () => {
    expect(buildManhuaBgmBrief(base).prompt).toContain("[Intro");
  });

  it("[End] 必须在 —— 治「长档偏短」的正解（22s 档给 21.4s 就是漏了它）", () => {
    expect(buildManhuaBgmBrief(base).prompt.trim().endsWith("[End]")).toBe(true);
  });

  it("画面有静音停顿时插 [Break]，让模型自己留空", () => {
    const p = buildBgmStructurePrompt({ moods: ["蓄力", "冲突"], hasSilenceBreak: true });
    expect(p).toContain("[Break");
    // [Break] 必须在爆点之前——那口「憋」是最大一刀之前的呼吸
    expect(p.indexOf("[Break")).toBeLessThan(p.indexOf("[Peak"));
  });

  it("没有静音停顿就不插 [Break]", () => {
    expect(buildBgmStructurePrompt({ moods: ["蓄力", "冲突"] })).not.toContain("[Break");
  });

  it("段情绪拆成每段的 Performance Cue，不全堆 style 里", () => {
    const p = buildManhuaBgmBrief(base).prompt;
    expect(p).toContain("压迫渐增");
    expect(p).toContain("断裂点砸下");
  });

  it("总有 Outro，收尾方式带进去", () => {
    expect(buildManhuaBgmBrief({ ...base, moods: ["蓄力"], endingZh: "悬在不解决的和弦" }).prompt)
      .toContain("悬在不解决的和弦");
  });
});

describe("生成参数", () => {
  it("纯音乐双保险：instrumental ＋ negative_tags（概率抑制不是硬过滤，两道都要）", () => {
    const b = buildManhuaBgmBrief(base);
    expect(b.instrumental).toBe(true);
    expect(b.negative_tags).toContain("vocals");
  });

  it("style_weight 要它听话，weirdness 压低让配乐托底不抢戏", () => {
    const b = buildManhuaBgmBrief(base);
    expect(b.style_weight).toBeGreaterThanOrEqual(0.75);
    expect(b.style_weight).toBeLessThanOrEqual(0.82);
    expect(b.weirdness_constraint).toBeLessThanOrEqual(0.3);
  });

  it("duration 只在 v5.5 + custom_mode 生效，故两者写死", () => {
    const b = buildManhuaBgmBrief(base);
    expect(b.model).toBe("suno-v5.5-beta");
    expect(b.custom_mode).toBe(true);
  });
});

describe("时长", () => {
  it("比画面长 2–4 秒留裁切余量 —— 长档还偏短", () => {
    expect(resolveBgmDurationSec(18)).toBe(21);
  });

  it("夹到 10–360", () => {
    expect(resolveBgmDurationSec(1)).toBe(BGM_DURATION_MIN_SEC);
    expect(resolveBgmDurationSec(1e9)).toBe(BGM_DURATION_MAX_SEC);
    expect(clampBgmDurationSec(Number.NaN)).toBe(BGM_DURATION_MIN_SEC);
  });
});

describe("艺人名检测与提交前校验", () => {
  it("在世音乐家点名会被 Suno 拦，要提示转译成可听特征", () => {
    expect(looksLikeArtistName("cello是Yo Yo Ma的悠扬风格")).toBe(true);
    expect(looksLikeArtistName("久石让 风格")).toBe(true);
  });

  it("普通电影风格不误判 —— 上一版的泛化正则把「悬疑电影风格」也拦了", () => {
    expect(looksLikeArtistName("悬疑电影风格，低音弦乐铺底")).toBe(false);
    expect(looksLikeArtistName("仙侠电影风格")).toBe(false);
  });

  it("作品名可以用（Mission Impossible / 十面埋伏 实测有效）", () => {
    expect(looksLikeArtistName("Mission Impossible 风格，节奏高燃")).toBe(false);
    expect(looksLikeArtistName("琵琶十面埋伏拨弦三次")).toBe(false);
  });

  it("提交前校验：人名拒、普通风格过", () => {
    expect(() => assertBgmStyleSubmittable({ style: "Hans Zimmer 风格" })).toThrow("可听特征");
    expect(() => assertBgmStyleSubmittable({ style: "悬疑电影风格" })).not.toThrow();
  });

  it("styleOverrideZh 绕不过校验 —— 上一版这个函数没人调", () => {
    const b = buildManhuaBgmBrief({ ...base, styleOverrideZh: "cello 是 Yo Yo Ma 的悠扬" });
    expect(() => assertBgmStyleSubmittable(b)).toThrow();
  });
});

describe("用户改写", () => {
  it("改过的 style 原样送上游，不在用户文本上追加标签", () => {
    const b = buildManhuaBgmBrief({ ...base, styleOverrideZh: "我自己写的一段" });
    expect(b.style).toBe("我自己写的一段");
  });
});

