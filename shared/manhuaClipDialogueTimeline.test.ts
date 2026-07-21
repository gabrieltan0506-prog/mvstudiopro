import { describe, expect, it } from "vitest";
import {
  buildManhuaDialogueTimelineBeats,
  extractManhuaSceneHintFromPrompt,
  formatManhuaDialogueTimelineBlock,
  MANHUA_CROSS_SHOT_CONTINUITY_LOCK,
  MANHUA_SEEDANCE_AUDIO_DIRECTOR_LOCK,
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

  it("formats director sheet with cut / camera / voiced dialogue", () => {
    const block = formatManhuaDialogueTimelineBlock(
      [
        {
          index: 5,
          durationSec: 0,
          cameraZh: "近景，微推",
          actionZh: "握拳",
          dialogueZh: "放开！",
          emotionZh: "怒",
          microExpressionZh: "咬牙",
          voiceToneZh: "压嗓",
        },
      ],
      15,
      { segmentIndex: 2, sceneHintZh: "古宅廊下" },
    );
    expect(block).toContain("视频生成导戏单");
    expect(block).toContain("一轮");
    expect(block).toContain("分镜5｜近景｜15秒｜约0–15s");
    expect(block).toContain("切镜：开场建立");
    expect(block).toContain("运镜：");
    expect(block).toContain("场景：古宅廊下");
    expect(block).toContain("配音/对白");
    expect(block).toContain("放开");
    expect(block).toContain("咬牙");
    expect(block).toContain("只重出本段");
    expect(MANHUA_CROSS_SHOT_CONTINUITY_LOCK).toMatch(/换脸|服装|跳棚/);
    expect(MANHUA_SEEDANCE_AUDIO_DIRECTOR_LOCK).toMatch(/配音|口型|时间轴/);
  });

  it("extracts scene name from keyart prompt", () => {
    expect(
      extractManhuaSceneHintFromPrompt("前言\n【本集主场景优先】古宅廊下\n直接吸收"),
    ).toBe("古宅廊下");
  });

  it("segment clip inject includes director sheet and audio lock", () => {
    const text = formatWorkbenchSegmentClipInjectBlock({
      segmentIndex: 1,
      durationSec: 15,
      sceneHintZh: "雨夜巷口",
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
    expect(text).toContain("视频生成导戏单");
    expect(text).toContain("分镜1");
    expect(text).toContain("约0–7.5s");
    expect(text).toContain("切镜：");
    expect(text).toContain("场景：雨夜巷口");
    expect(text).toContain("配音台词顺序核验");
    expect(text).toContain("成片配音与导戏硬锁");
    expect(text).toContain("只重出本段");
    expect(text).toContain("跨镜连续硬锁");
    expect(text).toMatch(/换脸|服装/);
    expect(text).toContain("有声配音");
  });
});
