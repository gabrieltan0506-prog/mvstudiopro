import { describe, expect, it } from "vitest";
import {
  buildManhuaDialogueTimelineBeats,
  formatManhuaDialogueTimelineBlock,
  MANHUA_CROSS_SHOT_CONTINUITY_LOCK,
} from "./manhuaClipDialogueTimeline";
import { formatWorkbenchSegmentClipInjectBlock } from "./manhuaScriptWorkbench";

describe("manhuaClipDialogueTimeline", () => {
  it("assigns second ranges and emotion fields per shot", () => {
    const beats = buildManhuaDialogueTimelineBeats(
      [
        {
          index: 1,
          durationSec: 0,
          cameraZh: "近景",
          actionZh: "抬头",
          dialogueZh: "拿着",
          emotionZh: "决绝",
          microExpressionZh: "下颌绷紧",
        },
        {
          index: 2,
          durationSec: 0,
          cameraZh: "中景",
          actionZh: "后退",
          dialogueZh: "你早就知道了？",
          emotionZh: "不信",
          microExpressionZh: "眼眶发红",
        },
      ],
      15,
    );
    expect(beats).toHaveLength(2);
    expect(beats[0]?.startSec).toBe(0);
    expect(beats[0]?.endSec).toBe(7.5);
    expect(beats[1]?.startSec).toBe(7.5);
    expect(beats[1]?.dialogueZh).toContain("你早就知道了");
    expect(beats[0]?.microExpressionZh).toContain("下颌");
  });

  it("formats timeline block for Seedance clip inject", () => {
    const block = formatManhuaDialogueTimelineBlock(
      [
        {
          index: 5,
          durationSec: 0,
          cameraZh: "近景",
          actionZh: "握拳",
          dialogueZh: "放开！",
          emotionZh: "怒",
          microExpressionZh: "咬牙",
        },
      ],
      15,
      { segmentIndex: 2 },
    );
    expect(block).toContain("成片表演剧本");
    expect(block).toContain("一轮生成");
    expect(block).toMatch(/分镜5（近景 15秒|约0–15s）/);
    expect(block).toContain("放开");
    expect(block).toContain("咬牙");
    expect(block).toContain("只重出本段");
    expect(MANHUA_CROSS_SHOT_CONTINUITY_LOCK).toMatch(/换脸|服装|跳棚/);
  });

  it("segment clip inject includes feel-style script and continuity lock", () => {
    const text = formatWorkbenchSegmentClipInjectBlock({
      segmentIndex: 1,
      durationSec: 15,
      shots: [
        {
          index: 1,
          durationSec: 0,
          cameraZh: "近景",
          actionZh: "递出玉佩",
          dialogueZh: "拿着",
          emotionZh: "决绝",
          microExpressionZh: "目光钉死",
        },
        {
          index: 2,
          durationSec: 0,
          cameraZh: "中景",
          actionZh: "握紧后退",
          dialogueZh: "你早就知道了？",
          emotionZh: "不信",
        },
      ],
    });
    expect(text).toContain("成片表演剧本");
    expect(text).toContain("分镜1");
    expect(text).toContain("约0–7.5s");
    expect(text).toContain("只重出本段");
    expect(text).toContain("跨镜连续硬锁");
    expect(text).toMatch(/换脸|服装/);
  });
});
