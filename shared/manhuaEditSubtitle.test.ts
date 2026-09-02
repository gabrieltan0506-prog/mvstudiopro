import { describe, expect, it } from "vitest";
import { buildRoughCutClipsFromShots } from "./manhuaEditWorkflowBank";
import {
  buildManhuaSubtitleBurnSrt,
  buildManhuaSubtitleCues,
  formatManhuaSubtitleSrt,
  sanitizeBurnSubtitleText,
  type ManhuaSubtitleCue,
} from "./manhuaEditSubtitle";

describe("manhuaEditSubtitle", () => {
  const shots = [
    { index: 1, durationSec: 5, cameraZh: "中景平视", dialogueZh: "你回来了", actionZh: "推门" },
    { index: 2, durationSec: 5, cameraZh: "近景过肩", actionZh: "对视" },
  ];

  it("builds cues only when enabled and dialogue present", () => {
    const rough = buildRoughCutClipsFromShots(shots, { order: [1, 2] });
    expect(
      buildManhuaSubtitleCues({ roughClips: rough, shots, enabled: false }),
    ).toHaveLength(0);
    const cues = buildManhuaSubtitleCues({
      roughClips: rough,
      shots,
      enabled: true,
      fineCutByShot: { 1: { inSec: 1, outSec: 4 } },
    });
    expect(cues).toHaveLength(1);
    expect(cues[0]?.textZh).toBe("你回来了");
    expect(cues[0]?.startSec).toBe(0);
    expect(cues[0]?.endSec).toBe(3);
  });

  it("formats srt", () => {
    const srt = formatManhuaSubtitleSrt([
      { shotIndex: 1, order: 1, startSec: 0, endSec: 3, textZh: "你好" },
    ]);
    expect(srt).toContain("00:00:00,000 --> 00:00:03,000");
    expect(srt).toContain("你好");
  });
});

describe("buildManhuaSubtitleBurnSrt(烧字 SRT)", () => {
  const cue = (over: Partial<ManhuaSubtitleCue>): ManhuaSubtitleCue => ({
    shotIndex: 1,
    order: 1,
    startSec: 0,
    endSec: 3,
    textZh: "你好",
    ...over,
  });

  it("时间码 HH:MM:SS,mmm,跨小时与毫秒进位都不出坏位", () => {
    const srt = buildManhuaSubtitleBurnSrt([
      cue({ startSec: 0, endSec: 3.5 }),
      cue({ order: 2, startSec: 59.9996, endSec: 3661.25, textZh: "跨小时" }),
    ]);
    expect(srt).toContain("00:00:00,000 --> 00:00:03,500");
    // 59.9996s 按位拆会出 "00:00:59,1000";整体取整后必须进位成整分
    expect(srt).toContain("00:01:00,000 --> 01:01:01,250");
    expect(srt).not.toContain(",1000");
  });

  it("编号连续、按起点排序、cue 间空行分隔", () => {
    const srt = buildManhuaSubtitleBurnSrt([
      cue({ order: 2, startSec: 5, endSec: 8, textZh: "后说" }),
      cue({ order: 1, startSec: 0, endSec: 3, textZh: "先说" }),
    ]);
    const lines = srt.split("\n");
    expect(lines[0]).toBe("1");
    expect(lines[2]).toBe("先说");
    expect(lines[3]).toBe("");
    expect(lines[4]).toBe("2");
    expect(lines[6]).toBe("后说");
  });

  it("台词清洗:覆写块/伪时间码/空行注入全部拦下,多行台词保留", () => {
    const srt = buildManhuaSubtitleBurnSrt([
      cue({
        textZh: "{\\pos(0,0)}第一行\n\n99\n00:00:00,000 --> 00:59:00,000\n第二行",
      }),
    ]);
    // ASS 覆写块被断开成全角括号,libass 不再当样式解析
    expect(srt).toContain("｛\\pos(0,0)｝第一行");
    // 台词内不允许再出现可被解析的时间码行(唯一的 --> 是真时间码行)
    expect(srt.match(/ --> /g)).toHaveLength(1);
    expect(srt).toContain("00:00:00,000 → 00:59:00,000");
    // 空行注入被滤掉:台词各行紧贴,伪造不出第二条 cue
    expect(srt).toContain("第一行\n99\n00:00:00,000 → 00:59:00,000\n第二行");
  });

  it("空轨/清洗后全空/坏时间码一律报错", () => {
    expect(() => buildManhuaSubtitleBurnSrt([])).toThrow("字幕轨为空");
    expect(() => buildManhuaSubtitleBurnSrt([cue({ textZh: " \n " })])).toThrow(
      "没有可烧的台词",
    );
    expect(() => buildManhuaSubtitleBurnSrt([cue({ startSec: 3, endSec: 3 })])).toThrow(
      "时间码不可用",
    );
    expect(() => buildManhuaSubtitleBurnSrt([cue({ startSec: -1 })])).toThrow(
      "时间码不可用",
    );
  });

  it("sanitizeBurnSubtitleText 单测:\\r 清除与行首尾修剪", () => {
    expect(sanitizeBurnSubtitleText("  甲\r\n乙  \r\n")).toBe("甲\n乙");
  });
});
