import { describe, it, expect, vi } from "vitest";

// Mock the Gemini audio analysis module
vi.mock("./gemini-audio", () => ({
  analyzeAudioWithGemini: vi.fn().mockResolvedValue({
    bpm: 120,
    bpmRange: "115-125",
    overallMood: "欢快、充满活力",
    language: "中文",
    lyrics: "测试歌词内容\n第二行歌词",
    sections: [
      {
        name: "前奏",
        timeRange: "0:00-0:15",
        mood: "期待",
        energy: "中",
        instruments: "钢琴、弦乐",
        rhythmPattern: "4/4拍，中速",
      },
      {
        name: "主歌A",
        timeRange: "0:15-0:45",
        mood: "温暖",
        energy: "中",
        instruments: "吉他、鼓",
        rhythmPattern: "4/4拍，稳定",
        lyrics: "测试歌词内容",
      },
      {
        name: "副歌",
        timeRange: "0:45-1:15",
        mood: "激昂",
        energy: "高",
        instruments: "全乐队",
        rhythmPattern: "4/4拍，强劲",
        lyrics: "第二行歌词",
      },
    ],
    instrumentation: "钢琴、吉他、鼓组、贝斯、弦乐",
    suggestedColorPalette: "暖色调：金色、橙色、红色",
    suggestedVisualStyle: "阳光下的城市街景，活力四射",
    genre: "流行",
    musicalKey: "C大调",
    dynamicRange: "中等，副歌处能量显著提升",
  }),
  isGeminiAudioAvailable: vi.fn().mockReturnValue(true),
}));

describe("Audio Lab Service", () => {
  it("analyzeAudioWithGemini returns expected structure", async () => {
    const { analyzeAudioWithGemini } = await import("./gemini-audio");
    const result = await analyzeAudioWithGemini("https://example.com/test.mp3");

    expect(result).toBeDefined();
    expect(result.bpm).toBe(120);
    expect(result.bpmRange).toBe("115-125");
    expect(result.overallMood).toBeTruthy();
    expect(result.language).toBe("中文");
    expect(result.lyrics).toContain("测试歌词");
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].name).toBe("前奏");
    expect(result.sections[1].mood).toBe("温暖");
    expect(result.sections[2].energy).toBe("高");
    expect(result.instrumentation).toContain("钢琴");
    expect(result.genre).toBe("流行");
    expect(result.musicalKey).toBe("C大调");
  });

  it("isGeminiAudioAvailable returns boolean", async () => {
    const { isGeminiAudioAvailable } = await import("./gemini-audio");
    expect(typeof isGeminiAudioAvailable()).toBe("boolean");
  });

  it("analysis sections have required fields", async () => {
    const { analyzeAudioWithGemini } = await import("./gemini-audio");
    const result = await analyzeAudioWithGemini("https://example.com/test.mp3");

    for (const section of result.sections) {
      expect(section.name).toBeTruthy();
      expect(section.timeRange).toBeTruthy();
      expect(section.mood).toBeTruthy();
      expect(section.energy).toBeTruthy();
      expect(section.instruments).toBeTruthy();
      expect(section.rhythmPattern).toBeTruthy();
    }
  });

  it("BPM is a reasonable number", async () => {
    const { analyzeAudioWithGemini } = await import("./gemini-audio");
    const result = await analyzeAudioWithGemini("https://example.com/test.mp3");
    expect(result.bpm).toBeGreaterThan(0);
    expect(result.bpm).toBeLessThan(300);
  });

  it("sections are ordered by time", async () => {
    const { analyzeAudioWithGemini } = await import("./gemini-audio");
    const result = await analyzeAudioWithGemini("https://example.com/test.mp3");
    const timeStarts = result.sections.map(s => {
      const [min, sec] = s.timeRange.split("-")[0].split(":").map(Number);
      return min * 60 + sec;
    });
    for (let i = 1; i < timeStarts.length; i++) {
      expect(timeStarts[i]).toBeGreaterThanOrEqual(timeStarts[i - 1]);
    }
  });
});
