import { describe, expect, it } from "vitest";
import {
  MANHUA_NATIVE_AUDIO_MAX_TRACKS,
  mergeManhuaNativeAudioChunks,
  parseManhuaNativeAudioAnalysis,
  type ManhuaNativeAudioTrack,
} from "./manhuaNativeAudioAnalysis";

const track = (fromSec: number): ManhuaNativeAudioTrack => ({
  fromSec,
  toSec: fromSec + 1,
  emotionArcZh: `情绪${fromSec}`,
  toneZh: "克制",
  sfxZh: "",
  bgmZh: "低频",
  atmosphereZh: "压迫",
  silenceZh: "",
  cues: [],
});

describe("原生精读音轨合并", () => {
  it("超过128段时合并相邻轨道，压缩后仍连续覆盖全片", () => {
    const durationSec = MANHUA_NATIVE_AUDIO_MAX_TRACKS + 7;
    const merged = mergeManhuaNativeAudioChunks({
      durationSec,
      chunks: [{
        audioTrack: Array.from({ length: durationSec }, (_, index) => track(index)),
        audioBeatStructureZh: "持续推进",
        mixNotesZh: "人声居中",
        reusableAudioZh: "连续增强",
        genAudioHintZh: "保留层次",
      }],
      usage: {
        inputTokens: 10,
        audioInputTokens: 8,
        outputTokens: 2,
        costCny: 0.01,
        receiptComplete: true,
        geminiInputTokens: 10,
        geminiAudioInputTokens: 8,
        geminiOutputTokens: 2,
        geminiCostCny: 0.01,
        geminiCalls: 2,
      },
    });
    expect(merged.audioTrack).toHaveLength(MANHUA_NATIVE_AUDIO_MAX_TRACKS);
    expect(merged.audioTrack[0]?.fromSec).toBe(0);
    expect(merged.audioTrack.at(-1)?.toSec).toBe(durationSec);
    expect(merged.audioTrack.every((row, index, rows) =>
      index === 0 || row.fromSec === rows[index - 1]?.toSec,
    )).toBe(true);
    expect(parseManhuaNativeAudioAnalysis(merged)).toBeDefined();
  });
});
