import { describe, expect, it } from "vitest";
import { videoBreakdownFixture as fixture, videoBreakdownFixtureRich } from "./videoBreakdown.fixture";
import { buildManhuaBgmBrief, deriveManhuaBgmBriefSeed } from "./manhuaBgmBrief";
import { manhuaBgmArcFromShots } from "./manhuaBgmArcFromShots";
import { buildVideoBreakdownBgmPrompt, videoBreakdownSegmentMood, videoBreakdownSegmentToBgmShot } from "./videoBreakdownBgm";

describe("拉片配乐提示词（复用工厂确定性函数）", () => {
  it("每段映射成配音间的一镜：时长、意图、情绪、手法；有人声才带对白", () => {
    const seg = { ...fixture.segments[1], expression: { ...fixture.segments[1].expression, sound: "主角低声对白，雨声铺底" } };
    expect(videoBreakdownSegmentToBgmShot(seg)).toEqual({
      index: 1, durationSec: seg.endSec - seg.startSec, cameraZh: "", actionZh: "冷暖对比",
      intentZh: "第2段建立威胁", emotionZh: "先慢后快", dialogueZh: "主角低声对白，雨声铺底",
    });
    expect(videoBreakdownSegmentToBgmShot(fixture.segments[0]).dialogueZh).toBeUndefined();
    expect(videoBreakdownSegmentToBgmShot(fixture.segments[3]).dialogueZh).toBeUndefined();
  });

  it("情绪按关键词命中，命不中按段位兜底", () => {
    const at = (rhythm: string, index = 1, total = 4) => videoBreakdownSegmentMood({ ...fixture.segments[0], expression: { ...fixture.segments[0].expression, narrativeIntent: "", technique: "", rhythm } }, { index, total });
    expect(at("剧情突然反转")).toBe("反转");
    expect(at("紧张对峙，急促快切")).toBe("冲突");
    expect(at("余韵渐弱")).toBe("收束");
    expect(at("缓慢铺垫")).toBe("蓄力");
    expect(at("平铺直叙", 0)).toBe("蓄力");
    expect(at("平铺直叙", 3)).toBe("收束");
    expect(at("平铺直叙", 2)).toBe("冲突");
  });

  it("输出 = 工厂情绪线 + 工厂 brief 的风格与结构，时长用实测片长", () => {
    const text = buildVideoBreakdownBgmPrompt(fixture);
    const arc = manhuaBgmArcFromShots(fixture.segments.map(videoBreakdownSegmentToBgmShot), 17);
    expect(text.startsWith(arc)).toBe(true);
    expect(text).toContain("0.0–4.2秒：第1段建立威胁；先慢后快；冷暖对比");
    expect(text).toContain("12.8–17.0秒");
    // 四段叙事意图都含「建立」→ 全是蓄力；工厂种子去重后补末拍收束
    const moods = fixture.segments.map((s, index) => videoBreakdownSegmentMood(s, { index, total: 4 }));
    expect(moods).toEqual(["蓄力", "蓄力", "蓄力", "蓄力"]);
    const seed = deriveManhuaBgmBriefSeed({ laneZh: "", segmentBeatFunctionsZh: [[], [], [], []], storyEmotion: { moods, hasSilenceBreak: false } });
    expect(seed.moods).toEqual(["蓄力", "收束"]);
    const brief = buildManhuaBgmBrief({ ...seed, durationSec: 17 });
    expect(text).toContain(`【配乐风格】${brief.style}`);
    expect(text).toContain(brief.prompt);
    expect(brief.prompt).toContain("[End]");
    expect(text).toContain("【时长】约 20 秒（含 3 秒裁切余量）");
    expect(text).not.toMatch(/suno|evolink|ttapi/i);
  });

  it("有静音段时结构里插入留白", () => {
    const quiet = { ...fixture, segments: fixture.segments.map((s, i) => (i === 2 ? { ...s, expression: { ...s.expression, sound: "全场静默两秒" } } : s)) };
    expect(buildVideoBreakdownBgmPrompt(quiet)).toContain("[Break");
    expect(buildVideoBreakdownBgmPrompt(fixture)).not.toContain("[Break");
  });

  it("纯函数：同输入同输出，不改原对象", () => {
    const before = JSON.stringify(fixture);
    expect(buildVideoBreakdownBgmPrompt(fixture)).toBe(buildVideoBreakdownBgmPrompt(fixture));
    expect(JSON.stringify(fixture)).toBe(before);
  });

  it("有声音拆解时优先用：生成声音要素当乐器、声音节奏当节奏走向、情绪推进当弧线", () => {
    const text = buildVideoBreakdownBgmPrompt(videoBreakdownFixtureRich);
    const style = /【配乐风格】(.*)/.exec(text)?.[1] || "";
    expect(style).toBe("不安 → 紧张 → 惊惧 → 怅然，低音大鼓、弦乐颤音、雷声采样，速度由 70 到 120 bpm，前 8 秒稀疏雨声，8.5 秒起鼓点加密，末段只剩低频，最后两秒渐弱淡出，不顶在高潮上，20秒，44.1KHz，纯器乐");
    expect(text).toContain("[End]");
    // 只有声音节奏、没有生成要素：沿用工厂按题材兜底的乐器句，节奏换成看片结论
    const partial = { ...fixture, overview: { ...fixture.overview, sound: { ...videoBreakdownFixtureRich.overview.sound!, generationElements: " " } } };
    const partialStyle = /【配乐风格】(.*)/.exec(buildVideoBreakdownBgmPrompt(partial))?.[1] || "";
    expect(partialStyle).toContain("前 8 秒稀疏雨声");
    expect(partialStyle).not.toContain("低音大鼓");
    expect(/【配乐风格】(.*)/.exec(buildVideoBreakdownBgmPrompt(fixture))?.[1]).not.toContain("稀疏雨声");
  });
});
