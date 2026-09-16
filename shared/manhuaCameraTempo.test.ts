import { describe, expect, it } from "vitest";
import { appendManhuaCameraPromptToMotionGuide, resolveManhuaCameraTempo } from "./manhuaCameraTempo";
import { listManhuaDirectionCards } from "./manhuaDirectionCanonLibrary";

describe("节奏策略 · 意图/接触 → 快慢档", () => {
  it("燃/爽/打脸等词命中 → fast：8 镜、半秒、反应 1s、硬切", () => {
    const t = resolveManhuaCameraTempo({ intentZh: "让观众看到他逆袭打脸", hasContact: false });
    expect(t.tier).toBe("fast");
    expect(t).toMatchObject({ style: "hard", maxCuts: 8, minShotSec: 0.5, reactionHoldSec: 1.0 });
    expect(t.reasonZh).toMatch(/打脸|逆袭/);
  });
  it("有接触事件 → fast，即使意图是慢词", () => {
    const t = resolveManhuaCameraTempo({ intentZh: "她迟疑了", hasContact: true });
    expect(t.tier).toBe("fast");
    expect(t.reasonZh).toContain("接触");
    // 1471 R1：冲突时把被覆盖的慢词写进原因，创作者看得见为什么没走慢档
    expect(t.reasonZh).toContain("迟疑");
    expect(t.reasonZh).toContain("覆盖");
    const both = resolveManhuaCameraTempo({ intentZh: "燃到静", hasContact: false });
    expect(both.tier).toBe("fast");
    expect(both.reasonZh).toContain("快词优先");
  });
  it("戳/亏欠/迟疑/静且无接触 → slow：3 镜、3 秒、反应 4s、慢环绕", () => {
    const t = resolveManhuaCameraTempo({ intentZh: "让观众被亏欠感戳到", hasContact: false });
    expect(t.tier).toBe("slow");
    expect(t).toMatchObject({ style: "slow_orbit", maxCuts: 3, minShotSec: 3, reactionHoldSec: 4 });
    expect(t.reasonZh).toMatch(/亏欠|戳/);
  });
  it("无命中无接触 → neutral：5 镜、1.5 秒、反应 2s、硬切；空意图也能算", () => {
    expect(resolveManhuaCameraTempo({ intentZh: "两人对话", hasContact: false })).toMatchObject({ tier: "neutral", style: "hard", maxCuts: 5, minShotSec: 1.5, reactionHoldSec: 2 });
    expect(resolveManhuaCameraTempo({ hasContact: false }).tier).toBe("neutral");
    expect(resolveManhuaCameraTempo({ hasContact: false }).reasonZh.length).toBeGreaterThan(0);
  });
  it("eventManner 里有 ranged/melee 视作有接触", () => {
    expect(resolveManhuaCameraTempo({ hasContact: false, eventManner: { e1: "ranged" } }).tier).toBe("fast");
  });
});

describe("节奏策略 · 导演卡映射（读卡的手法文本）", () => {
  const byLabel = (needle: string) => listManhuaDirectionCards().find((c) => c.labelZh.includes(needle))!;
  it("「大场面/戏核/角色视点」卡 → slow_orbit 建立镜优先，快档切点不变", () => {
    const card = byLabel("大场面");
    expect(card).toBeTruthy();
    const t = resolveManhuaCameraTempo({ intentZh: "燃", hasContact: true, directionCardId: card.id });
    expect(t.tier).toBe("fast");
    expect(t.style).toBe("slow_orbit");
    expect(t.establishFirst).toBe(true);
    expect(t.reasonZh).toContain("导演包");
  });
  it("「非人角色先成为人物」卡 → 反应镜给非人角色、lens 55", () => {
    const card = byLabel("非人角色");
    expect(card).toBeTruthy();
    const t = resolveManhuaCameraTempo({ intentZh: "静", hasContact: false, directionCardId: card.id });
    expect(t.reactionToNonHuman).toBe(true);
    expect(t.reactionLens).toBe(55);
  });
  it("手法文本含「动作必须改变关系」→ fast 且反应镜 ≥2s（用文本直传，卡库暂无此句）", () => {
    const t = resolveManhuaCameraTempo({ intentZh: "两人对话", hasContact: false, directionRulesText: "动作必须改变关系" });
    expect(t.tier).toBe("fast");
    expect(t.reactionHoldSec).toBeGreaterThanOrEqual(2);
  });
  it("未知卡 id → 当作无卡", () => {
    const t = resolveManhuaCameraTempo({ intentZh: "燃", hasContact: false, directionCardId: "no_such_card" });
    expect(t.style).toBe("hard");
    expect(t.reasonZh).not.toContain("导演包");
  });
});

describe("运镜句并入运动指引：超出上限截断且保留前面镜头", () => {
  it("全部放得下就逐镜追加；放不下保留前缀镜并标明", () => {
    const guide = "白模：甲 0–2s 走位";
    const lines = ["0.00–1.00s 全景·平视·固定机位：建立", "1.00–2.00s 中景·仰角·固定机位：接触", "2.00–3.00s 特写·平视·固定机位：反应"];
    const full = appendManhuaCameraPromptToMotionGuide(guide, lines, 10_000);
    expect(full).toContain(guide);
    for (const l of lines) expect(full).toContain(l);
    const cut = appendManhuaCameraPromptToMotionGuide(guide, lines, guide.length + 70);
    expect(cut).toContain(lines[0]);
    expect(cut).not.toContain(lines[2]);
    expect(cut.length).toBeLessThanOrEqual(guide.length + 70);
    expect(appendManhuaCameraPromptToMotionGuide(guide, [], 100)).toBe(guide);
  });
});
