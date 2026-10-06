import { describe, expect, it } from "vitest";
import { canvasAudioCueSchema, createCanvasAudioCue } from "./canvasAudioStudio";

describe("WF08 短片段新增音轨默认秒窗", () => {
  it.each([0.5, 1, 1.5, 3, 4, 5, 15, 3600])("%s秒对白、音效和BGM都产生合法默认", durationSec => {
    for (const kind of ["dialogue", "sfx", "bgm"] as const) {
      const cue = canvasAudioCueSchema.parse(createCanvasAudioCue(kind, "new-test-cue", durationSec));
      expect(cue.startSec).toBeGreaterThanOrEqual(0);
      expect(cue.endSec).toBeGreaterThan(cue.startSec);
      expect(cue.endSec).toBeLessThanOrEqual(durationSec);
      if (kind === "bgm") { expect(cue.startSec).toBe(0); expect(cue.endSec).toBe(durationSec); }
    }
  });
  it("未传时长的原调用和已存在的音轨不变", () => {
    expect(createCanvasAudioCue("dialogue", "old")).toMatchObject({ startSec: 1.5, endSec: 5, sourceEndSec: 5 });
    expect(createCanvasAudioCue("bgm", "old")).toMatchObject({ startSec: 0, endSec: 5, sourceEndSec: 5 });
  });
  it.each([0, -1, Infinity, NaN, 3601])("拒绝无效片段长度%s，不静默修正业务输入", durationSec => {
    expect(() => createCanvasAudioCue("dialogue", "new-test-cue", durationSec)).toThrow("本段时长无效");
  });
});
