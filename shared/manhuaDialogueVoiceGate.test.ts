import { describe, expect, it } from "vitest";
import {
  evaluateManhuaDialogueSilenceDetectLog,
  evaluateManhuaDialogueVoiceGate,
  mergeManhuaDialogueVoiceRegions,
  parseManhuaDialogueVoiceRegions,
} from "./manhuaDialogueVoiceGate";

describe("对白 silencedetect 证据", () => {
  it("没有静音事件时把整段视作有声", () => {
    expect(parseManhuaDialogueVoiceRegions("ffmpeg completed", 1.25)).toEqual([
      { start: 0, end: 1.25 },
    ]);
    expect(
      evaluateManhuaDialogueSilenceDetectLog({
        silenceDetectLog: "ffmpeg completed",
        durationSeconds: 1.25,
      }).accepted
    ).toBe(true);
  });

  it("整段静音时明确拒收", () => {
    const result = evaluateManhuaDialogueSilenceDetectLog({
      silenceDetectLog: [
        "[silencedetect] silence_start: 0",
        "[silencedetect] silence_end: 2.000 | silence_duration: 2.000",
      ].join("\n"),
      durationSeconds: 2,
    });
    expect(result).toMatchObject({
      accepted: false,
      reason: "no_effective_voice",
      voicedSeconds: 0,
      voicedRatio: 0,
    });
  });

  it("首尾静音之间的对白能通过", () => {
    const result = evaluateManhuaDialogueSilenceDetectLog({
      silenceDetectLog: [
        "silence_start: 0",
        "silence_end: 0.4 | silence_duration: 0.4",
        "silence_start: 1.6",
        "silence_end: 2.0 | silence_duration: 0.4",
      ].join("\n"),
      durationSeconds: 2,
    });
    expect(result).toMatchObject({
      accepted: true,
      voicedSeconds: 1.2,
      voicedRatio: 0.6,
      voiceRegions: [{ start: 0.4, end: 1.6 }],
    });
  });

  it("只有 silence_start 时按静音延续到结尾处理", () => {
    expect(parseManhuaDialogueVoiceRegions("silence_start: 0.3", 2)).toEqual([
      { start: 0, end: 0.3 },
    ]);
  });
});

describe("供应商无关的人声门禁", () => {
  it("合并重叠并裁切越界区间，不重复累计时长", () => {
    expect(
      mergeManhuaDialogueVoiceRegions(
        [
          { start: -1, end: 0.5 },
          { start: 0.3, end: 1.2 },
          { start: 1.2, end: 3 },
        ],
        2
      )
    ).toEqual([{ start: 0, end: 2 }]);
  });

  it("长音频中的瞬态噪声达不到有效人声占比", () => {
    expect(
      evaluateManhuaDialogueVoiceGate({
        durationSeconds: 10,
        voiceRegions: [{ start: 4, end: 4.2 }],
      })
    ).toMatchObject({
      accepted: false,
      reason: "insufficient_effective_voice",
      voicedRatio: 0.02,
    });
  });

  it("极短但全程有声的语气词不会被固定秒数误杀", () => {
    expect(
      evaluateManhuaDialogueVoiceGate({
        durationSeconds: 0.15,
        voiceRegions: [{ start: 0, end: 0.15 }],
      })
    ).toMatchObject({ accepted: true, voicedRatio: 1 });
  });

  it("无效容器时长 fail closed", () => {
    expect(
      evaluateManhuaDialogueVoiceGate({
        durationSeconds: Number.NaN,
        voiceRegions: [{ start: 0, end: 1 }],
      })
    ).toMatchObject({ accepted: false, reason: "invalid_audio_duration" });
  });
});
