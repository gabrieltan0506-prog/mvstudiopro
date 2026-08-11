import { describe, expect, it } from "vitest";
import {
  buildQwenTtsVoiceId,
  pickQwenTtsVoice,
  QWEN_TTS_VOICE_CATALOG,
} from "./qwenTtsVoiceCatalog";

describe("qwenTtsVoiceCatalog", () => {
  it("目录完整：597 条、后缀唯一、字段齐", () => {
    expect(QWEN_TTS_VOICE_CATALOG).toHaveLength(597);
    const suffixes = new Set(QWEN_TTS_VOICE_CATALOG.map((v) => v.suffix));
    expect(suffixes.size).toBe(597);
    for (const v of QWEN_TTS_VOICE_CATALOG.slice(0, 20)) {
      expect(v.suffix).toMatch(/^[a-z0-9]+$/);
      expect(["男", "女"]).toContain(v.gender);
      expect(v.nameZh.length).toBeGreaterThan(1);
    }
  });

  it("voice id 按模型前缀拼接", () => {
    expect(buildQwenTtsVoiceId("flash", "longcanzhuyue")).toBe(
      "qwen-audio-3.0-tts-flash-longcanzhuyue",
    );
    expect(buildQwenTtsVoiceId("plus", "longcanzhuyue")).toBe(
      "qwen-audio-3.0-tts-plus-longcanzhuyue",
    );
  });

  it("选角：老人/小孩/性别/特质都能圈到", () => {
    const oldMan = pickQwenTtsVoice({ gender: "男", minAge: 55 });
    expect(oldMan).not.toBeNull();
    expect(oldMan!.age).toBeGreaterThanOrEqual(55);
    const kid = pickQwenTtsVoice({ maxAge: 12 });
    expect(kid).not.toBeNull();
    expect(kid!.age).toBeLessThanOrEqual(12);
    const warmFemale = pickQwenTtsVoice({ gender: "女", traitLike: "温柔" });
    expect(warmFemale).not.toBeNull();
    expect(warmFemale!.gender).toBe("女");
    expect(pickQwenTtsVoice({ gender: "男", minAge: 200 })).toBeNull();
  });
});
