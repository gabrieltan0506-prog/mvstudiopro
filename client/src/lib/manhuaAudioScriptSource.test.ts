import { expect, it } from "vitest";
import { createCanvasAudioCue } from "@shared/canvasAudioStudio";
import { manhuaScriptCueSourceIssue } from "./manhuaAudioScriptSource";

it("原镜对白须与当前来源相同，来源缺失时不建立付费单；手写对白仍可用", () => {
  const original = {
    ...createCanvasAudioCue("dialogue", "script-shot-15-line-1"),
    speakerZh: "娘",
    textZh: "阿菁……那马……",
    startSec: 0,
    endSec: 5,
  };
  const current = { ...original, textZh: "阿菁，那馬是怎麼回事呀？" };
  expect(manhuaScriptCueSourceIssue(original, [current], true)).toContain("未提交付费配音");
  expect(manhuaScriptCueSourceIssue(current, [current], true)).toBeUndefined();
  expect(manhuaScriptCueSourceIssue(current, undefined, false)).toContain("原稿尚未读取到");
  expect(manhuaScriptCueSourceIssue({ ...original, id: "manual-dialogue" }, undefined, false)).toBeUndefined();
});
