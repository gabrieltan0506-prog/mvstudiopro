import { describe, it, expect } from "vitest";
import { pcm16At16k, pcmFloat } from "./creativeVoiceMedia";
describe("Live PCM音讯转换", () => {
  it("48k按真实采样率转16k且保留正负振幅", () => {
    const samples = Float32Array.from([1, 1, 1, -1, -1, -1]);
    const result = pcmFloat(pcm16At16k(samples, 48000));
    expect(result).toHaveLength(2); expect(result[0]).toBeCloseTo(1, 4); expect(result[1]).toBe(-1);
  });
  it("拒绝损坏PCM并将超范围振幅裁剪", () => {
    expect(() => pcmFloat(btoa("a"))).toThrow();
    expect(pcmFloat(pcm16At16k(new Float32Array([5, -5]), 16000))[1]).toBe(-1);
  });
});
