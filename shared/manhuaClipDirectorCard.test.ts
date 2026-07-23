import { describe, expect, it } from "vitest";
import { formatWorkbenchSegmentClipInjectBlock } from "./manhuaScriptWorkbench";
import {
  formatManhuaClipDirectorCueFaceLine,
  parseManhuaClipDirectorCardSummary,
} from "./manhuaClipDirectorCard";

describe("manhuaClipDirectorCard", () => {
  it("parses second cue rows and @ locks from real segment prompt", () => {
    const prompt = formatWorkbenchSegmentClipInjectBlock({
      segmentIndex: 1,
      durationSec: 15,
      sceneHintZh: "边关烽火台",
      shots: [
        {
          index: 1,
          durationSec: 5,
          cameraZh: "远景建立",
          actionZh: "@角色5 立于 @场景1 垛口",
          dialogueZh: "今晚不报，边关就没了。",
          emotionZh: "决绝",
          microExpressionZh: "下颌绷紧",
          voiceToneZh: "压嗓",
        },
        {
          index: 2,
          durationSec: 5,
          cameraZh: "近景微推",
          actionZh: "@角色5 亮出 @道具1",
          dialogueZh: "拿着。",
          emotionZh: "逼人",
          microExpressionZh: "眉心微蹙",
        },
        {
          index: 3,
          durationSec: 5,
          cameraZh: "对切",
          actionZh: "@角色4 接卷轴",
          dialogueZh: "你早就知道了？",
          emotionZh: "不敢信",
          microExpressionZh: "眼眶发紧",
        },
      ],
    });
    const card = parseManhuaClipDirectorCardSummary(prompt);
    expect(card.segmentIndex).toBe(1);
    expect(card.durationSec).toBe(15);
    expect(card.castTags).toEqual(expect.arrayContaining(["@角色5", "@角色4"]));
    expect(card.sceneTags).toContain("@场景1");
    expect(card.cueRows.length).toBeGreaterThanOrEqual(2);
    expect(card.cueRows[0]?.castTags.length || card.castTags.length).toBeGreaterThan(0);
    const face = formatManhuaClipDirectorCueFaceLine(card.cueRows[0]!);
    expect(face).toMatch(/\d+[–-]\d+/);
  });
});
