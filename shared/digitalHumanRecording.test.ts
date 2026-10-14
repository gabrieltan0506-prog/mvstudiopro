import { describe, expect, it } from "vitest";
import { assertDigitalHumanRecording } from "./digitalHumanRecording";
describe("本人录音时长与格式", () => {
  it.each([3, 15, 20, 30])("接受%s秒清晰录音的技术长度", durationSec => {
    expect(() =>
      assertDigitalHumanRecording({
        durationSec,
        bytes: 1024,
        fileName: "本人.m4a",
      })
    ).not.toThrow();
  });
  it.each([0, 2.99, 30.01, Infinity, NaN])(
    "拒绝%s秒，不能截断凑数",
    durationSec => {
      expect(() =>
        assertDigitalHumanRecording({
          durationSec,
          bytes: 1024,
          fileName: "本人.wav",
        })
      ).toThrow("3–30秒");
    }
  );
  it("拒绝空文件、超20MB与不受支持格式", () => {
    for (const input of [
      { bytes: 0, fileName: "a.wav" },
      { bytes: 20 * 1024 * 1024 + 1, fileName: "a.wav" },
      { bytes: 1024, fileName: "a.webm" },
    ])
      expect(() =>
        assertDigitalHumanRecording({ ...input, durationSec: 15 })
      ).toThrow();
  });
});
