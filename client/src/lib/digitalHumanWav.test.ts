import { describe, expect, it } from "vitest";
import { encodeDigitalHumanWav } from "./digitalHumanWav";
describe("网页录音转PCM WAV", () => {
  it("分别保留左右声道、采样率和时长，不降混", () => {
    const left = new Float32Array(16000 * 3).fill(0.5);
    const right = new Float32Array(16000 * 3).fill(-0.25);
    const wav = encodeDigitalHumanWav([left, right], 16000),
      view = new DataView(wav);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(40, true)).toBe(192000);
    expect(view.getUint32(28, true)).toBe(64000);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getInt16(44, true)).toBe(16384);
    expect(view.getInt16(46, true)).toBe(-8192);
  });
  it("拒绝不足3秒、超过30秒、无效通道和非有限音频数据", () => {
    expect(() =>
      encodeDigitalHumanWav([new Float32Array(47999)], 16000)
    ).toThrow();
    expect(() =>
      encodeDigitalHumanWav([new Float32Array(480001)], 16000)
    ).toThrow();
    expect(() => encodeDigitalHumanWav([], 16000)).toThrow();
    expect(() =>
      encodeDigitalHumanWav([new Float32Array(48000).fill(NaN)], 16000)
    ).toThrow();
  });
});
