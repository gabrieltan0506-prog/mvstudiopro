import { describe, expect, it } from "vitest";
import { buildSubtitleEffectAss, wrapSubtitleEffectText } from "./subtitleEffects";
import { burnSubtitleParamsSchema } from "../jobs/postProdInput";

const subtitleSrt = "1\n00:00:01,000 --> 00:00:03,000\n小杂种，该不会是要拿它来抵药钱吧\n\n2\n00:00:05,000 --> 00:00:07,000\n可是……\n你肩上的傷還沒有好……\n";
const input = { subtitleSrt, effect: "fade" as const, width: 2160, height: 3840, styleOverride: { fontSize: 16, outline: 0.35, marginV: 12 } };

describe("字幕特效编译", () => {
  it("保留每句时间和全部文字，按竖屏宽度换行并保持原有断行", () => {
    const ass = buildSubtitleEffectAss(input);
    const events = ass.split("\n").filter(line => line.startsWith("Dialogue:"));
    expect(events).toHaveLength(2);
    expect(events[0]).toContain("0:00:01.00,0:00:03.00");
    expect(events[1]).toContain("0:00:05.00,0:00:07.00");
    expect(events[0].split("}")[1].replace(/\\N/g, "")).toBe("小杂种，该不会是要拿它来抵药钱吧");
    expect(events[1]).toContain("可是……\\N");
    expect(events[1].split("}")[1].replace(/\\N/g, "")).toBe("可是……你肩上的傷還沒有好……");
    expect(ass).toContain("PlayResX: 162\nPlayResY: 288");
    expect(ass).toContain("Style: Default,Noto Sans CJK SC,16,");
    expect(ass).toContain("\\fad(160,160)");
    expect(ass).not.toContain("\\t(");
  });

  it("轻弹效果真实写入ASS，短句淡入淡出不吞掉整个显示窗口", () => {
    const ass = buildSubtitleEffectAss({ ...input, effect: "pop", subtitleSrt: "1\n00:00:00,000 --> 00:00:00,080\n快\n" });
    expect(ass).toContain("\\fad(20,20)\\fscx94\\fscy94\\t(0,20,\\fscx100\\fscy100)");
    expect(ass).toContain("0:00:00.00,0:00:00.08");
  });

  it("时间只按ASS精度取整，不累积平移；量化成零时长则拒绝", () => {
    expect(buildSubtitleEffectAss({ ...input, subtitleSrt: "1\n00:00:59,996 --> 00:01:01,004\n你好\n" })).toContain("0:01:00.00,0:01:01.00");
    expect(() => buildSubtitleEffectAss({ ...input, subtitleSrt: "1\n00:00:00,001 --> 00:00:00,004\n你好\n" })).toThrow("太短");
  });

  it("用户ASS标签与转义不会注入动画或假造换行", () => {
    const ass = buildSubtitleEffectAss({ ...input, width: 1920, height: 1080, subtitleSrt: "1\n00:00:01,000 --> 00:00:03,000\n{\\pos(1,2)}你好\\N世界\n" });
    expect(ass).not.toContain("\\pos(");
    expect(ass).toContain("｛＼pos(1,2)｝你好＼N世界");
    expect(() => buildSubtitleEffectAss({ ...input, styleOverride: { fontName: "Arial\n[Events]" } })).toThrow();
  });

  it("横竖屏都按画幅排版；过长与无效尺寸明确失败，不截断", () => {
    expect(buildSubtitleEffectAss({ ...input, width: 1920, height: 1080 })).toContain("PlayResX: 512");
    expect(() => buildSubtitleEffectAss({ ...input, width: 0 })).toThrow("尺寸");
    expect(() => buildSubtitleEffectAss({ ...input, subtitleSrt: `1\n00:00:01,000 --> 00:00:03,000\n${"好".repeat(300)}\n` })).toThrow("过长");
    const wrapped = wrapSubtitleEffectText("你好世界，大家好！\n👨‍👩‍👧‍👦一起回家", 4);
    expect(wrapped.join("")).toBe("你好世界，大家好！👨‍👩‍👧‍👦一起回家");
    expect(wrapped.some(line => line.startsWith("，"))).toBe(false);
    expect(wrapped.some(line => line.includes("👨‍👩‍👧‍👦"))).toBe(true);
  });

  it("旧任务无特效默认不变，只收枚举值，不接收用户自定义脚本", () => {
    const old = { videoUri: "gs://test/original.mp4", subtitleSrt };
    expect(burnSubtitleParamsSchema.parse(old)).toEqual(old);
    for (const effect of ["none", "fade", "pop"]) {
      expect(burnSubtitleParamsSchema.parse({ ...old, effect }).effect).toBe(effect);
    }
    expect(() => burnSubtitleParamsSchema.parse({ ...old, effect: "\\t(1,2)" })).toThrow();
    expect(() => burnSubtitleParamsSchema.parse({ ...old, ass: "[Events]" })).toThrow();
  });
});
